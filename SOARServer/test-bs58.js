const bs58 = require('bs58');

const encoded = '3MNQE1X';
const decoded = bs58.decode(encoded);

console.log('Decoded:', decoded);
console.log('Encoded again:', bs58.encode(decoded));
