import assert from 'node:assert/strict';
import {createFontServices} from '../../platform/browser/fonts.js';

const logical = {width:30, actualBoundingBoxLeft:0, actualBoundingBoxRight:30,
  actualBoundingBoxAscent:9, actualBoundingBoxDescent:2};
const raster = {width:61, actualBoundingBoxLeft:1.25, actualBoundingBoxRight:62.75,
  actualBoundingBoxAscent:20.1, actualBoundingBoxDescent:5.2};
const measured = [], drawn = [];
globalThis.OffscreenCanvas = class {
  getContext() {
    return {
      measureText() {
        measured.push(this.font);
        return this.font === '400 26px "Test"' ? raster : logical;
      },
      fillText(text, x, y) { drawn.push({font:this.font,text,x,y}); },
      getImageData(x, y, width, height) { return {data:new Uint8ClampedArray(width * height * 4)}; }
    };
  }
};
const resources = new Map();
const faces = new Map([['regular', {family:'Test',weight:400}]]);
let next = 1;
const fonts = createFontServices({mask:() => ({})}, faces, resources, () => next++);
const handle = fonts.open(null, 'regular', 13);
assert.equal(fonts.width(handle, 'Docs'), 30);
const full = fonts.mask(handle, 'Docs', 2, -100, -100, 100, 100);
const bounds = ({left,top,logicalWidth,logicalHeight}) => [left,top,logicalWidth,logicalHeight];
assert.deepEqual(bounds(resources.get(full)), [-1.5, -11, 33.5, 14.5],
  'The mask must fit ink measured at the rasterized size.');
assert.deepEqual(drawn[0], {font:'400 26px "Test"',text:'Docs',x:3,y:22});
assert.equal(fonts.mask(handle, 'Docs', 2, -100, -100, 100, 100), full);
const clipped = fonts.mask(handle, 'Docs', 2, 2, -5, 10, 1);
assert.deepEqual(bounds(resources.get(clipped)), [1.5, -5.5, 9, 7],
  'The mask must still respect the logical clipping box.');
assert.equal(fonts.width(handle, 'Docs'), 30, 'Raster bounds must not affect layout widths.');
assert.deepEqual(measured, ['400 13px "Test"', '400 26px "Test"']);
console.log('Text masks retain high-density ink, logical clipping and independent layout widths.');
