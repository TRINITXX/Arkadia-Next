import { describe, expect, it } from "vite-plus/test";

import {
  downmixToMono,
  floatToPcm16,
  FrameBuffer,
  FRAME_SAMPLE_COUNT,
  resampleMono,
  TARGET_SAMPLE_RATE,
} from "./audioEncoding";

const readInt16 = (bytes: Uint8Array, index: number): number =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getInt16(index * 2, true);

describe("resampleMono", () => {
  it("renvoie l'entrée telle quelle quand la fréquence correspond déjà", () => {
    const input = Float32Array.from([0.1, 0.2, 0.3]);
    expect(resampleMono(input, TARGET_SAMPLE_RATE)).toBe(input);
  });

  it("réduit 48 kHz vers 16 kHz d'un facteur trois", () => {
    expect(resampleMono(new Float32Array(480), 48_000).length).toBe(160);
  });

  it("préserve une rampe linéaire aux points échantillonnés", () => {
    const output = resampleMono(Float32Array.from([0, 0.25, 0.5, 0.75]), 32_000, 16_000);
    expect(output.length).toBe(2);
    expect(output[0]).toBe(0);
    expect(output[1]).toBe(0.5);
  });

  it("tolère une entrée vide", () => {
    expect(resampleMono(new Float32Array(0), 48_000).length).toBe(0);
  });
});

describe("floatToPcm16", () => {
  it("produit deux octets par échantillon", () => {
    expect(floatToPcm16(Float32Array.from([0, 0, 0])).length).toBe(6);
  });

  it("place le silence à zéro et les extrêmes aux bornes du format", () => {
    const bytes = floatToPcm16(Float32Array.from([0, 1, -1]));
    expect(readInt16(bytes, 0)).toBe(0);
    expect(readInt16(bytes, 1)).toBe(32767);
    expect(readInt16(bytes, 2)).toBe(-32768);
  });

  it("écrête au lieu de replier les valeurs saturées", () => {
    const bytes = floatToPcm16(Float32Array.from([2.5, -2.5]));
    expect(readInt16(bytes, 0)).toBe(32767);
    expect(readInt16(bytes, 1)).toBe(-32768);
  });

  it("encode en little-endian", () => {
    const bytes = floatToPcm16(Float32Array.from([1]));
    expect(bytes[0]).toBe(0xff);
    expect(bytes[1]).toBe(0x7f);
  });
});

describe("downmixToMono", () => {
  it("renvoie le canal unique sans copie", () => {
    const channel = Float32Array.from([0.5, -0.5]);
    expect(downmixToMono([channel])).toBe(channel);
  });

  it("moyenne les canaux d'un signal stéréo", () => {
    const output = downmixToMono([Float32Array.from([1, 0]), Float32Array.from([0, 1])]);
    expect(Array.from(output)).toEqual([0.5, 0.5]);
  });

  it("tolère l'absence de canal", () => {
    expect(downmixToMono([]).length).toBe(0);
  });
});

describe("FrameBuffer", () => {
  it("ne relâche rien tant qu'une trame n'est pas pleine", () => {
    expect(new FrameBuffer().push(new Float32Array(FRAME_SAMPLE_COUNT - 1))).toEqual([]);
  });

  it("relâche une trame complète dès qu'elle est atteinte", () => {
    const frames = new FrameBuffer().push(new Float32Array(FRAME_SAMPLE_COUNT));
    expect(frames.length).toBe(1);
    expect(frames[0]?.length).toBe(FRAME_SAMPLE_COUNT * 2);
  });

  it("découpe un gros bloc en plusieurs trames et garde le reliquat", () => {
    const buffer = new FrameBuffer();
    expect(buffer.push(new Float32Array(FRAME_SAMPLE_COUNT * 2 + 10)).length).toBe(2);
    expect(buffer.flush()).not.toBeNull();
  });

  it("complète la dernière trame par du silence", () => {
    const buffer = new FrameBuffer();
    buffer.push(Float32Array.from([1, 1]));
    const tail = buffer.flush();
    expect(tail?.length).toBe(FRAME_SAMPLE_COUNT * 2);
    expect(tail && readInt16(tail, 0)).toBe(32767);
    expect(tail && readInt16(tail, FRAME_SAMPLE_COUNT - 1)).toBe(0);
  });

  it("ne relâche rien au vidage quand tout a déjà été envoyé", () => {
    const buffer = new FrameBuffer();
    buffer.push(new Float32Array(FRAME_SAMPLE_COUNT));
    expect(buffer.flush()).toBeNull();
  });
});
