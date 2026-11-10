import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';

// Decode Chrome screenshots for test-side pixel assertions.
export function readPng(base64) {
  const png = Buffer.from(base64, 'base64'), chunks = [];
  let width, height, channels;
  for (let offset = 8; offset < png.length;) {
    const count = png.readUInt32BE(offset), kind = png.toString('ascii',offset+4,offset+8);
    if (kind === 'IHDR') {
      width = png.readUInt32BE(offset+8); height = png.readUInt32BE(offset+12);
      assert.equal(png[offset+16],8);
      channels = {2:3,6:4}[png[offset+17]]; assert(channels);
    }
    if (kind === 'IDAT') chunks.push(png.subarray(offset+8,offset+8+count));
    offset += count + 12;
  }
  const source = inflateSync(Buffer.concat(chunks)), stride = width*channels;
  const pixels = Buffer.alloc(stride*height);
  let offset = 0;
  const paeth = (a,b,c) => {
    const p=a+b-c, da=Math.abs(p-a), db=Math.abs(p-b), dc=Math.abs(p-c);
    return da<=db && da<=dc ? a : db<=dc ? b : c;
  };
  for (let y=0;y<height;y++) {
    const filter = source[offset++]; assert(filter<=4);
    for (let x=0;x<stride;x++) {
      const position=y*stride+x;
      const a=x>=channels ? pixels[position-channels] : 0;
      const b=y>0 ? pixels[position-stride] : 0;
      const c=y>0 && x>=channels ? pixels[position-stride-channels] : 0;
      const predict=[0,a,b,Math.floor((a+b)/2),paeth(a,b,c)][filter];
      pixels[position]=(source[offset++]+predict)&255;
    }
  }
  assert.equal(offset,source.length);
  return { width,height,pixel(x,y) {
    return [...pixels.subarray((y*width+x)*channels,(y*width+x)*channels+3)];
  } };
}
