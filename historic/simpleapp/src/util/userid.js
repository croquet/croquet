export const userID = Array.from(crypto.getRandomValues(new Uint8Array(3)))
    .map(e => e.toString(16).padStart(2, '0'))
    .join('');
