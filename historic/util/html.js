import SeedRandom from "seedrandom";

export function displaySessionMoniker(id='', element='session') {
    const button = document.getElementById(element);
    document.title = document.title.replace(/:.*/, '');
    if (!id) {
        if (button) button.style.backgroundImage = '';
        return;
    }
    // random page title suffix
    document.title += ':';
    const random = new SeedRandom(id);
    const letters = ['bcdfghjklmnpqrstvwxyz', 'aeiou'];
    for (let i = 0; i < 10; i++) document.title += letters[i%2][random.quick() * letters[i%2].length|0];
    // image derived from id
    if (button) {
        const hash = [0,0,0,0].map(_=>(random.int32()>>>0).toString(16).padStart(8, '0')).join('');
        button.style.backgroundImage = `url('https://www.gravatar.com/avatar/${hash}?d=identicon&f=y')`;
    }
}
