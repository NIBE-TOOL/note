import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function extractScript(source) {
  const match = source.match(/<script>([\s\S]*?)<\/script>/);
  if (!match) {
    throw new Error('Inline script not found in note file.');
  }
  return match[1];
}

function createContext() {
  let counter = 0;
  const elements = new Map();
  const createElement = () => ({
    innerHTML: '',
    textContent: '',
    value: '',
    style: {},
    addEventListener: () => {},
    removeEventListener: () => {},
    setAttribute: () => {}
  });

  const documentStub = {
    getElementById(id) {
      if (!elements.has(id)) {
        elements.set(id, createElement());
      }
      return elements.get(id);
    },
    querySelectorAll() {
      return [];
    },
    addEventListener: () => {}
  };

  const windowStub = {
    document: documentStub,
    print: () => {},
    addEventListener: () => {},
    removeEventListener: () => {}
  };

  const context = {
    window: windowStub,
    document: documentStub,
    console,
    crypto: {
      randomUUID() {
        counter += 1;
        return `uuid-${counter}`;
      }
    },
    Intl,
    Math,
    setTimeout,
    clearTimeout
  };

  windowStub.window = windowStub;
  return { context, windowStub };
}

const notePath = path.resolve(__dirname, '..', 'note');
const html = fs.readFileSync(notePath, 'utf-8');
const scriptContent = extractScript(html);

const { context, windowStub } = createContext();
vm.createContext(context);
vm.runInContext(scriptContent, context);

const appWindow = windowStub;

function resetState() {
  const state = appWindow.__appState;
  state.step = 0;
  state.installer = { company: '', address: '', siret: '' };
  state.beneficiary = {
    firstName: '',
    lastName: '',
    address: '',
    postalCode: '',
    city: '',
    constructionYear: '',
    seaside: false,
    altitudeBand: '0-200',
    baseTemperature: null
  };
  state.project = { zones: [] };
  state.technology = {
    type: null,
    model: null,
    sourceTemperature: '0',
    units: 1,
    airflow: null
  };
}

test('base temperature follows postal code and altitude tables', () => {
  resetState();
  const state = appWindow.__appState;
  state.beneficiary.postalCode = '38000';
  state.beneficiary.altitudeBand = '1201-1400';
  appWindow.render();
  assert.equal(appWindow.computeBaseTemperature(), -21);
});

test('seaside option forces -2°C regardless of altitude', () => {
  resetState();
  const state = appWindow.__appState;
  state.beneficiary.postalCode = '38000';
  state.beneficiary.altitudeBand = '1801-2000';
  state.beneficiary.seaside = true;
  appWindow.render();
  assert.equal(appWindow.computeBaseTemperature(), -2);
});

test('zone losses calculation and manual override', () => {
  resetState();
  const state = appWindow.__appState;
  state.beneficiary.postalCode = '75001';
  state.beneficiary.altitudeBand = '0-200';
  state.beneficiary.seaside = false;
  appWindow.render();

  appWindow.ensureZonesInitialized();
  const [zone] = state.project.zones;
  zone.surface = 50;
  zone.height = 2.5;
  zone.isolation = 'Isolation norme RE2020';
  zone.ambientTemp = 20;
  zone.manualOverride = false;
  zone.manualLoss = '';

  appWindow.updateZonesLosses();
  assert.ok(Math.abs(zone.calculatedLoss - 1350) < 1e-6);
  assert.ok(Math.abs(appWindow.getTotalLossesW() - 1350) < 1e-6);

  zone.manualOverride = true;
  zone.manualLoss = '2000';
  appWindow.updateZonesLosses();
  assert.ok(Math.abs(appWindow.getTotalLossesW() - 2000) < 1e-6);
});
