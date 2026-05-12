import { getMapboxToken, getGoogleKey, setMapboxToken, setGoogleKey, isFromLocalStorage } from './apiKeys';

const STYLE_ID = '__mr_keys_style';

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const css = `
    .mr-keys-bg {
      position: fixed; inset: 0; background: rgba(0,0,0,0.65); backdrop-filter: blur(8px);
      z-index: 2000; display: grid; place-items: center;
      font: 14px system-ui, -apple-system, sans-serif;
    }
    .mr-keys {
      background: #0f0f0f; color: #fff; border: 1px solid #2a2a2a;
      border-radius: 12px; width: 480px; max-width: 92vw;
      padding: 22px; box-shadow: 0 24px 70px rgba(0,0,0,0.7);
    }
    .mr-keys h2 { margin: 0 0 4px; font-size: 17px; font-weight: 600; }
    .mr-keys .sub { color: #8a8a8a; font-size: 12px; margin-bottom: 16px; }
    .mr-keys label { display: block; font-size: 10px; text-transform: uppercase;
      letter-spacing: 0.6px; color: #7a7a7a; margin: 14px 0 4px; }
    .mr-keys .row { display: grid; grid-template-columns: 1fr auto; gap: 8px; align-items: stretch; }
    .mr-keys input {
      width: 100%; box-sizing: border-box; background: #0a0a0a; color: #fff;
      border: 1px solid #2a2a2a; border-radius: 6px; padding: 8px 10px;
      font: 13px ui-monospace, Menlo, Consolas, monospace; outline: none;
    }
    .mr-keys input:focus { border-color: #3a6bff; }
    .mr-keys .toggle-show {
      background: #141414; color: #fff; border: 1px solid #2a2a2a; border-radius: 6px;
      padding: 0 12px; cursor: pointer; font: 12px system-ui;
    }
    .mr-keys .hint {
      font-size: 11px; color: #7a7a7a; margin-top: 4px;
    }
    .mr-keys .hint a { color: #6aa9ff; }
    .mr-keys .source { font-size: 10px; color: #5a5a5a; margin-top: 2px; }
    .mr-keys .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }
    .mr-keys .actions button {
      background: #141414; color: #fff; border: 1px solid #333;
      padding: 7px 14px; border-radius: 6px; cursor: pointer; font: inherit;
    }
    .mr-keys .actions button:hover { background: #1d1d1d; }
    .mr-keys .actions button.primary { background: #2a5bff; border-color: #2a5bff; }
    .mr-keys .actions button.primary:hover { background: #3a6bff; }
    .mr-keys .reload-note { font-size: 11px; color: #c5a76a; margin-top: 8px; }
  `;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = css;
  document.head.appendChild(s);
}

export type ApiKeysModalOpts = {
  blocking?: boolean;
  focus?: 'mapbox' | 'google';
  reloadOnSave?: boolean;
};

export function openApiKeysModal(opts: ApiKeysModalOpts = {}): Promise<boolean> {
  ensureStyles();
  const blocking = opts.blocking ?? false;
  const reloadOnSave = opts.reloadOnSave ?? true;

  return new Promise(resolve => {
    const bg = document.createElement('div');
    bg.className = 'mr-keys-bg';
    bg.innerHTML = `
      <div class="mr-keys" role="dialog" aria-modal="true">
        <h2>API Keys</h2>
        <div class="sub">Required to access Mapbox tiles and Google Maps APIs. Stored locally on this device only.</div>

        <label for="mr-mapbox">Mapbox Public Token</label>
        <div class="row">
          <input id="mr-mapbox" type="password" autocomplete="off" spellcheck="false" placeholder="pk.eyJ1Ijo…" />
          <button type="button" class="toggle-show" data-target="mr-mapbox">Show</button>
        </div>
        <div class="hint">From <a href="https://account.mapbox.com/" target="_blank" rel="noopener">account.mapbox.com</a></div>
        <div class="source" id="mr-mapbox-src"></div>

        <label for="mr-google">Google Maps API Key</label>
        <div class="row">
          <input id="mr-google" type="password" autocomplete="off" spellcheck="false" placeholder="AIza…" />
          <button type="button" class="toggle-show" data-target="mr-google">Show</button>
        </div>
        <div class="hint">Enable <strong>Map Tiles API</strong> + <strong>Elevation API</strong> in Google Cloud Console</div>
        <div class="source" id="mr-google-src"></div>

        <div class="reload-note" id="mr-reload-note" style="display:none">⟳ The app will reload after saving so the new keys take effect.</div>

        <div class="actions">
          <button id="mr-cancel" type="button">Cancel</button>
          <button id="mr-save" class="primary" type="button">Save</button>
        </div>
      </div>
    `;
    document.body.appendChild(bg);

    const $ = <T extends Element>(s: string) => bg.querySelector(s) as T;
    const mapboxEl = $('#mr-mapbox') as HTMLInputElement;
    const googleEl = $('#mr-google') as HTMLInputElement;
    const mapboxSrcEl = $('#mr-mapbox-src') as HTMLElement;
    const googleSrcEl = $('#mr-google-src') as HTMLElement;
    const saveBtn = $('#mr-save') as HTMLButtonElement;
    const cancelBtn = $('#mr-cancel') as HTMLButtonElement;
    const reloadNote = $('#mr-reload-note') as HTMLElement;

    const initialMapbox = getMapboxToken();
    const initialGoogle = getGoogleKey();
    mapboxEl.value = initialMapbox;
    googleEl.value = initialGoogle;

    function refreshSources() {
      mapboxSrcEl.textContent = initialMapbox
        ? (isFromLocalStorage('mapbox') ? 'currently from local storage' : 'currently from .env (bundled at build time)')
        : 'not configured';
      googleSrcEl.textContent = initialGoogle
        ? (isFromLocalStorage('google') ? 'currently from local storage' : 'currently from .env (bundled at build time)')
        : 'not configured';
    }
    refreshSources();

    bg.querySelectorAll('.toggle-show').forEach(btn => {
      btn.addEventListener('click', () => {
        const targetId = (btn as HTMLElement).dataset.target!;
        const input = bg.querySelector(`#${targetId}`) as HTMLInputElement;
        const showing = input.type === 'text';
        input.type = showing ? 'password' : 'text';
        (btn as HTMLElement).textContent = showing ? 'Show' : 'Hide';
      });
    });

    function update() {
      const changed =
        mapboxEl.value.trim() !== initialMapbox ||
        googleEl.value.trim() !== initialGoogle;
      reloadNote.style.display = changed && reloadOnSave ? 'block' : 'none';
    }
    mapboxEl.addEventListener('input', update);
    googleEl.addEventListener('input', update);

    function close(saved: boolean) {
      bg.remove();
      resolve(saved);
    }

    function submit() {
      const m = mapboxEl.value.trim();
      const g = googleEl.value.trim();
      const changed = m !== initialMapbox || g !== initialGoogle;
      setMapboxToken(m);
      setGoogleKey(g);
      if (changed && reloadOnSave) {
        location.reload();
        return;
      }
      close(true);
    }

    cancelBtn.addEventListener('click', () => {
      if (blocking) return;
      close(false);
    });
    saveBtn.addEventListener('click', submit);

    bg.addEventListener('click', e => {
      if (e.target === bg && !blocking) close(false);
    });
    document.addEventListener('keydown', function esc(e) {
      if (e.key === 'Escape' && !blocking) {
        document.removeEventListener('keydown', esc);
        close(false);
      }
    });

    if (blocking) {
      cancelBtn.style.display = 'none';
    }

    setTimeout(() => {
      (opts.focus === 'google' ? googleEl : mapboxEl).focus();
    }, 0);
  });
}
