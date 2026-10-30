// Live heart rate from any band that broadcasts the standard BLE Heart Rate
// service (0x180D) — e.g. WHOOP with "Broadcast Heart Rate" switched on.
//
// Both sources below emit the same events:
//   'status'  -> { state: 'connecting' | 'connected' | 'reconnecting' | 'disconnected', name }
//   'reading' -> { bpm, contact, rr, time }

const sleep = ms => new Promise(r => setTimeout(r, ms));

export class HeartRateMonitor extends EventTarget {
  device = null;
  #wantConnected = false;
  #reconnecting = false;

  static get supported() {
    return 'bluetooth' in navigator;
  }

  async connect() {
    // Must be called from a user gesture (button click) — Chrome shows a device picker.
    this.device = await navigator.bluetooth.requestDevice({
      filters: [{ services: ['heart_rate'] }],
    });
    this.device.addEventListener('gattserverdisconnected', () => this.#onDisconnect());
    this.#wantConnected = true;
    await this.#subscribe();
  }

  disconnect() {
    this.#wantConnected = false;
    if (this.device?.gatt.connected) this.device.gatt.disconnect();
    else this.#emit('status', { state: 'disconnected', name: this.device?.name });
  }

  async #subscribe() {
    this.#emit('status', { state: 'connecting', name: this.device.name });
    const server = await this.device.gatt.connect();
    const service = await server.getPrimaryService('heart_rate');
    const measurement = await service.getCharacteristic('heart_rate_measurement');
    measurement.addEventListener('characteristicvaluechanged', e =>
      this.#emit('reading', parseMeasurement(e.target.value)),
    );
    await measurement.startNotifications();
    this.#emit('status', { state: 'connected', name: this.device.name });
  }

  async #onDisconnect() {
    if (!this.#wantConnected) {
      this.#emit('status', { state: 'disconnected', name: this.device?.name });
      return;
    }
    if (this.#reconnecting) return;
    this.#reconnecting = true;
    // Bands drop out when someone walks away or jumps around — keep retrying quietly.
    for (let attempt = 0; this.#wantConnected && attempt < 12; attempt++) {
      this.#emit('status', { state: 'reconnecting', name: this.device.name });
      await sleep(Math.min(1000 * 2 ** attempt, 15000));
      if (!this.#wantConnected) break;
      try {
        await this.#subscribe();
        this.#reconnecting = false;
        return;
      } catch {
        // try again
      }
    }
    this.#reconnecting = false;
    this.#emit('status', { state: 'disconnected', name: this.device?.name });
  }

  #emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}

// Parses a Heart Rate Measurement characteristic value (Bluetooth spec 0x2A37).
export function parseMeasurement(view) {
  const flags = view.getUint8(0);
  const wide = flags & 0x01;
  let offset = 1;

  const bpm = wide ? view.getUint16(offset, true) : view.getUint8(offset);
  offset += wide ? 2 : 1;

  const contact = flags & 0x04 ? Boolean(flags & 0x02) : null;
  if (flags & 0x08) offset += 2; // energy expended, unused

  const rr = []; // ms between beats, when the band provides it
  if (flags & 0x10) {
    for (; offset + 1 < view.byteLength; offset += 2) {
      rr.push((view.getUint16(offset, true) / 1024) * 1000);
    }
  }
  return { bpm, contact, rr, time: Date.now() };
}

// Fake heart rate for building and testing without the band on.
export class SimulatedHeartRate extends EventTarget {
  #timer = null;
  #bpm = 72;
  #surge = 0;

  connect() {
    this.#emit('status', { state: 'connected', name: 'Simulator' });
    this.#timer = setInterval(() => {
      this.#surge *= 0.85;
      this.#bpm += (72 - this.#bpm) * 0.1 + (Math.random() - 0.5) * 3;
      const bpm = Math.round(this.#bpm + this.#surge);
      this.#emit('reading', { bpm, contact: true, rr: [], time: Date.now() });
    }, 1000);
  }

  // Simulates "the question hit a nerve".
  spike(amount = 25) {
    this.#surge += amount;
  }

  disconnect() {
    clearInterval(this.#timer);
    this.#emit('status', { state: 'disconnected', name: 'Simulator' });
  }

  #emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}
