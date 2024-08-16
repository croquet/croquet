import './style.css'
import typescriptLogo from '/typescript.svg'
import viteLogo from '/vite.svg'
import croquetLogo from '/croquet.png'
import { setupCounter } from './counter.ts'

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <div>
    <a href="https://vitejs.dev" target="_blank">
      <img src="${viteLogo}" class="logo" alt="Vite logo" />
    </a>
    <a href="https://www.typescriptlang.org/" target="_blank">
      <img src="${typescriptLogo}" class="logo vanilla" alt="TypeScript logo" />
    </a>
    <a href="https://croquet.io" target="_blank">
      <img src="${croquetLogo}" class="logo" alt="Croquet logo" />
    </a>
    <h1>Vite + TypeScript + Croquet</h1>
    <div class="card">
      <button id="counter" type="button"></button>
    </div>
    <p class="read-the-docs">
      Click on the Vite, TypeScript, and Croquet logos to learn more
    </p>
  </div>
`

setupCounter(document.querySelector<HTMLButtonElement>('#counter')!)
