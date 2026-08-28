from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import uvicorn
import json
from pathlib import Path
import os
from openai import OpenAI
from dotenv import load_dotenv

# RAG specific imports
from sentence_transformers import SentenceTransformer
import faiss
import numpy as np

# Load environment variables
load_dotenv(override=True)

# --- Configuration ---
# Unified configuration for both local (Ollama) and cloud (OpenAI)
IS_LOCAL = os.getenv("RUN_LOCALLY", "false").lower() == "true"
if IS_LOCAL:
    # Local Ollama setup
    BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434/v1")
    API_KEY = os.getenv("OLLAMA_API_KEY", "ollama")
    MODEL_NAME = os.getenv("OLLAMA_MODEL", "qwen2.5:7b")
else:
    # Cloud OpenAI setup
    BASE_URL = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
    API_KEY = os.getenv("OPENAI_API_KEY")
    MODEL_NAME = os.getenv("OPENAI_MODEL_NAME", "gpt-4o-mini")

KNOWLEDGE_DIR = Path.cwd().parent / "knowledge"
FAQ_PATH = KNOWLEDGE_DIR / "faq.jsonl"
FAISS_INDEX_PATH = KNOWLEDGE_DIR / "faiss_index.bin"
DOC_MAP_PATH = KNOWLEDGE_DIR / "doc_map.json"
EMBEDDING_MODEL = 'all-MiniLM-L6-v2'

# Initialize OpenAI client (works with both Ollama and OpenAI due to API compatibility)
client = OpenAI(
    base_url=BASE_URL,
    api_key=API_KEY
)

# --- RAG Engine ---
class RAGSystem:
    def __init__(self):
        self.embedding_model = SentenceTransformer(EMBEDDING_MODEL)
        self.index = None
        self.doc_map = []
        self.load_index()

    def create_index(self):
        print("Creating new FAISS index...")
        documents = []
        for file_path in KNOWLEDGE_DIR.glob("*.md"):
            with open(file_path, 'r', encoding='utf-8') as f:
                # Simple chunking by paragraph
                chunks = f.read().split('\n\n')
                for i, chunk in enumerate(chunks):
                    if chunk.strip():
                        self.doc_map.append({"source": str(file_path.name), "content": chunk})
                        documents.append(chunk)
        
        if not documents:
            print("No markdown documents found to index.")
            return

        embeddings = self.embedding_model.encode(documents, convert_to_tensor=True)
        dimension = embeddings.shape[1]
        self.index = faiss.IndexFlatL2(dimension)
        self.index.add(embeddings.cpu().numpy())
        
        faiss.write_index(self.index, str(FAISS_INDEX_PATH))
        with open(DOC_MAP_PATH, 'w', encoding='utf-8') as f:
            json.dump(self.doc_map, f)
        print(f"Index created with {len(documents)} chunks.")

    def load_index(self):
        if FAISS_INDEX_PATH.exists() and DOC_MAP_PATH.exists():
            print("Loading existing FAISS index.")
            self.index = faiss.read_index(str(FAISS_INDEX_PATH))
            with open(DOC_MAP_PATH, 'r', encoding='utf-8') as f:
                self.doc_map = json.load(f)
        else:
            self.create_index()

    def search(self, query: str, k: int = 3):
        if self.index is None:
            return "Knowledge base is not initialized."
        query_embedding = self.embedding_model.encode([query], convert_to_tensor=True)
        distances, indices = self.index.search(query_embedding.cpu().numpy(), k)
        
        results = []
        for i in indices[0]:
            if i != -1:
                results.append(self.doc_map[i])
        
        context = "\n---\n".join([res['content'] for res in results])
        return context

rag_system = RAGSystem()

# --- Load FAQ data ---
with FAQ_PATH.open('r', encoding='utf-8') as f:
    faqs = [json.loads(line) for line in f]

# --- System Prompt (Unified knowledge base) ---
def build_system_prompt(user_query: str):
    # Use RAG to retrieve relevant knowledge
    retrieved_context = rag_system.search(user_query)
    
    system_prompt = f"""你是台南新市區藝凡髮廊的專業AI客服助理，你必須嚴格按照以下的知識庫內容回答客人的所有問題，絕對不能杜撰任何資訊，如果客人問的問題不在以下知識庫裡，請禮貌地請客人打電話詢問店內：

# 檢索到的相關知識：
{retrieved_context}

# 店家基本資訊
- 地址：744臺南市新市區新市里和平街16巷4號
- 預約電話：06-501-4076
- 營業時間：星期一、二、四、五、六、日：上午 8:00 至 晚上 8:00。星期三：固定店休。
- 注意事項：本工作室為現金支付，且需要提前預約。

# 常見問題(FAQ)
"""
    # 把FAQ加進system prompt
    for faq in faqs:
        system_prompt += f"- Q{faq['faq']}: {faq['question']}\n  A: {faq['answer']}\n\n"

    system_prompt += """
## 回話規則
1. 你只回答和藝凡髮廊相關的問題，所有回答都必須從上面的知識庫提取。
2. 請全程使用溫馨親切的繁體中文口氣，就像在地的台南老闆娘一樣和客人對話。
3. 如果客人問的問題不在知識庫內，請說：「不好意思這部分我不太確定哦，麻煩您打電話到店裡問會更清楚唷，電話是06-501-4076」。
4. 永遠記得強調「請提前預約」以及「僅收現金」這兩個重要規定。
"""
    return system_prompt

# --- FastAPI App ---
app = FastAPI()

class ChatRequest(BaseModel):
    message: str
    session_id: str = "default_session"
    chat_history: list = []  # 保留聊天記錄

async def run_chat(message: str, chat_history: list):
    # 動態建構包含RAG檢索內容的system prompt
    system_prompt = build_system_prompt(message)
    
    # 構建訊息歷史
    messages = [{"role": "system", "content": system_prompt}]
    messages.extend(chat_history)
    messages.append({"role": "user", "content": message})
    
    print(f"Using model: {MODEL_NAME} at {BASE_URL}")
    print(f"System prompt built with RAG context length: {len(system_prompt)}")
    
    # 使用標準OpenAI API進行串流回應，相容Ollama和OpenAI
    stream = client.chat.completions.create(
        model=MODEL_NAME,
        messages=messages,
        stream=True
    )
    
    for chunk in stream:
        if chunk.choices[0].delta.content is not None:
            yield chunk.choices[0].delta.content

@app.post("/api/chat")
async def chat_endpoint(request: ChatRequest):
    return StreamingResponse(
        run_chat(request.message, request.chat_history),
        media_type="text/event-stream"
    )

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)