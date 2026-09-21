// Analyze which attribute value the PPU used per pixel (rerun scene, then probe shAt regs)
const path = require('path');
process.argv[2] = 'analyze';
require('/tmp/nes-emu/test/r2-pipeline-probe.js');
