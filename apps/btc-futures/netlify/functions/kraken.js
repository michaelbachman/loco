
// Kraken Futures proxy
function getFetch(){ if (typeof fetch !== 'undefined') return fetch; throw new Error('fetch unavailable in this runtime'); }
