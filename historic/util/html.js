import SeedRandom from "seedrandom";

export function displaySessionMoniker(id='', element='session') {
    const random = new SeedRandom(id);
    // random page title
    document.title = document.title.replace(/:.*/, '') + ':';
    const letters = ['bcdfghjklmnpqrstvwxyz', 'aeiou'];
    for (let i = 0; i < 10; i++) document.title += letters[i%2][random.quick() * letters[i%2].length|0];
    // image derived from id
    const button = document.getElementById(element);
    if (button) {
        const hash = [0,0,0,0].map(_=>(random.int32()>>>0).toString(16).padStart(8, '0')).join('');
        button.style.backgroundImage = id ? `url('https://www.gravatar.com/avatar/${hash}?d=identicon&f=y')` : '';
    }
}
