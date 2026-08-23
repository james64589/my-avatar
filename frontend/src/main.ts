import './style.css'

const root = document.getElementById('root')!
if (!root) throw new Error('no #root')

// ========== THEME (localStorage, default dark) ==========
function theme() { const t: any = localStorage.getItem('avatar-theme')
  if (t && (t === 'dark' || t === 'light')) root.setAttribute('data-theme', t)
}
