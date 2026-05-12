import { PRESETS } from './presets';
import { makeLocator, slugify } from './generateFlyover';
import type { LightPreset, Locator } from './types';

const STYLE_ID = '__mr_modal_style';

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const css = `
    .mr-modal-bg {
      position: fixed; inset: 0; background: rgba(0,0,0,0.55);
      backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
      z-index: 1000; display: grid; place-items: center;
      font: 14px system-ui, -apple-system, sans-serif;
    }
    .mr-modal {
      background: #0f0f0f; color: #fff; border: 1px solid #2a2a2a;
      border-radius: 12px; width: 440px; max-width: 92vw;
      padding: 20px 22px; box-shadow: 0 24px 70px rgba(0,0,0,0.7);
    }
    .mr-modal h2 { margin: 0 0 14px; font-size: 16px; font-weight: 600; }
    .mr-modal label {
      display: block; font-size: 10px; text-transform: uppercase;
      letter-spacing: 0.6px; color: #7a7a7a; margin: 12px 0 4px;
    }
    .mr-modal input, .mr-modal select {
      width: 100%; box-sizing: border-box; background: #0a0a0a; color: #fff;
      border: 1px solid #2a2a2a; border-radius: 6px; padding: 8px 10px;
      font: inherit; outline: none;
    }
    .mr-modal input:focus, .mr-modal select:focus { border-color: #3a6bff; }
    .mr-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .mr-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 18px; }
    .mr-actions button {
      background: #141414; color: #fff; border: 1px solid #333;
      padding: 7px 14px; border-radius: 6px; cursor: pointer; font: inherit;
    }
    .mr-actions button:hover { background: #1d1d1d; }
    .mr-actions button.primary { background: #2a5bff; border-color: #2a5bff; }
    .mr-actions button.primary:hover { background: #3a6bff; }
    .mr-actions button.primary:disabled { opacity: 0.4; cursor: not-allowed; background: #1a2a5a; border-color: #1a2a5a; }
    .mr-hint { font-size: 11px; color: #666; margin-top: 4px; }
  `;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = css;
  document.head.appendChild(s);
}

export function openAddLocationModal(): Promise<Locator | null> {
  ensureStyles();

  return new Promise(resolve => {
    const bg = document.createElement('div');
    bg.className = 'mr-modal-bg';
    bg.innerHTML = `
      <div class="mr-modal" role="dialog" aria-modal="true">
        <h2>Add location</h2>

        <label for="mr-preset">Preset venue</label>
        <select id="mr-preset">
          <option value="">— Custom coordinates —</option>
          ${PRESETS.map(p => `<option value="${p.id}">${p.name}</option>`).join('')}
        </select>

        <label for="mr-name">Name</label>
        <input id="mr-name" placeholder="e.g. Stade de Genève" autocomplete="off" />

        <div class="mr-row">
          <div>
            <label for="mr-lat">Latitude</label>
            <input id="mr-lat" type="number" step="0.000001" placeholder="46.5207" />
          </div>
          <div>
            <label for="mr-lng">Longitude</label>
            <input id="mr-lng" type="number" step="0.000001" placeholder="6.5830" />
          </div>
        </div>
        <div class="mr-hint">Tip: right-click on Google Maps → first line = "lat, lng".</div>

        <div class="mr-row">
          <div>
            <label for="mr-light">Light preset</label>
            <select id="mr-light">
              <option value="day">Day</option>
              <option value="dusk">Dusk</option>
              <option value="dawn">Dawn</option>
              <option value="night">Night</option>
            </select>
          </div>
          <div>
            <label for="mr-duration">Duration (sec)</label>
            <input id="mr-duration" type="number" step="0.5" min="2" max="30" value="9" />
          </div>
        </div>

        <div class="mr-actions">
          <button id="mr-cancel" type="button">Cancel</button>
          <button id="mr-add" class="primary" type="button" disabled>Add</button>
        </div>
      </div>
    `;
    document.body.appendChild(bg);

    const $ = <T extends Element>(sel: string) => bg.querySelector(sel) as T;
    const presetSel = $('#mr-preset') as HTMLSelectElement;
    const nameEl = $('#mr-name') as HTMLInputElement;
    const latEl = $('#mr-lat') as HTMLInputElement;
    const lngEl = $('#mr-lng') as HTMLInputElement;
    const lightEl = $('#mr-light') as HTMLSelectElement;
    const durEl = $('#mr-duration') as HTMLInputElement;
    const addBtn = $('#mr-add') as HTMLButtonElement;
    const cancelBtn = $('#mr-cancel') as HTMLButtonElement;

    function validate() {
      const lat = parseFloat(latEl.value);
      const lng = parseFloat(lngEl.value);
      const ok =
        nameEl.value.trim() !== '' &&
        !isNaN(lat) && lat >= -90 && lat <= 90 &&
        !isNaN(lng) && lng >= -180 && lng <= 180;
      addBtn.disabled = !ok;
    }

    presetSel.addEventListener('change', () => {
      const preset = PRESETS.find(p => p.id === presetSel.value);
      if (preset) {
        nameEl.value = preset.name;
        latEl.value = preset.lat.toString();
        lngEl.value = preset.lng.toString();
      }
      validate();
    });
    [nameEl, latEl, lngEl].forEach(el => el.addEventListener('input', validate));

    function close(result: Locator | null) {
      document.removeEventListener('keydown', onKey);
      bg.remove();
      resolve(result);
    }

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close(null);
      if (e.key === 'Enter' && !addBtn.disabled) submit();
    }

    function submit() {
      const name = nameEl.value.trim();
      const lat = parseFloat(latEl.value);
      const lng = parseFloat(lngEl.value);
      const duration = Math.max(2, parseFloat(durEl.value) || 9);
      const lightPreset = lightEl.value as LightPreset;
      const id = slugify(name);
      close(makeLocator({ id, name, lng, lat, duration, lightPreset }));
    }

    cancelBtn.addEventListener('click', () => close(null));
    addBtn.addEventListener('click', submit);
    bg.addEventListener('click', e => { if (e.target === bg) close(null); });
    document.addEventListener('keydown', onKey);

    setTimeout(() => presetSel.focus(), 0);
  });
}
