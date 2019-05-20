import urlOptions from "./urlOptions";
import { toBase64url, fromBase64url } from "./modules";


const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }

// persistent storage of user settings
export function getUser(key, defaultValue=undefined, initFn=null) {
    let user = {};
    try { user = JSON.parse(localStorage.croquetUser || "{}"); } catch (e) { /* ignore */}
    if (key in user) return user[key];
    if (initFn) {
        user[key] = initFn();
        if (user[key] !== defaultValue) localStorage.croquetUser = JSON.stringify(user);
        return user[key];
    }
    return defaultValue;
}


// login user
if (!getUser("name") || urlOptions.user) {
    const style = document.createElement("style");
    style.innerHTML = `
        .overlay {
            z-index:10000;
            position:absolute;
            left: 0;
            top: 0;
            width:100vw;
            height:100vh;
            background-color:#333;
            opacity:0.9;
            display:flex;
            align-items:center;
            justify-content:center
        }
        form {
            background-color: #fff;
            color: #666;
            border-radius: 10px;
            padding: 16px;
            font-size: 14px;
        }
        form dt { margin: 4px 0 }
        form dd { margin-left: 0 }
        form input {
            border: 1px solid #ccc;
            border-radius: 5px;
            min-height: 46px;
            padding: 10px;
            font-size: 16px;
            width: 100%;
            box-shadow: inset 0 1px 2px #666;
        }
        form input:invalid { border: 1px solid red; }
        form input:valid   { border: 1px solid #ccc; }
        form button {
            padding: 20px 32px;
            background-color: #3b5;
            color: #fff;
            border-radius: 50px;
            border-width:0;
            font-size: 16px;
            font-weight: 500;
            width: 100%;
        }
        .error {
            visibility: hidden;
            width: 250px;
            background-color: #fcc;
            color: #900;
            padding: 5px;
            border-radius: 6px;
            border: 1px solid #c99;
            position: absolute;
            margin-top: 5px;
            font-size: 12px;
        }
        .error::after {
            content: " ";
            position: absolute;
            bottom: 100%;  /* At the top of message */
            left: 10px;
            border-width: 5px;
            border-style: solid;
            border-color: transparent transparent #c99 transparent;
          }
        .notice {
            visibility: hidden;
            width: 270px;
            height: 70px;
            background-color: #fff;
            padding: 5px;
            position: absolute;
            margin-top: 5px;
            font-size: 12px;
        }
    `;
    document.head.appendChild(style);

    const dialog = document.createElement("form");
    dialog.innerHTML = `
        <dl>
            <dt><label for="user[name]">Username</label></dt>
            <dd>
                <input type="text" required pattern="^[a-zA-Z0-9_]*$" minlength="2" maxlength="15" name="user[name]" id="user[name]" placeholder="Enter a username" autocomplete="off" spellcheck="false"></input>
            </dd>
            <dd class="error"></dd>
            <dd class="notice"></dd>
        </dl>
        <dl>
            <dt><label for="user[email]">Email</label></dt>
            <dd>
                <input type="email" required id="user[email]" placeholder="you@example.com" autocomplete="off" spellcheck="false"></input>
            </dd>
            <dd class="error"></dd>
        </dl>
        <dl>
            <dt><label for="user[password]">Password</label></dt>
            <dd>
                <input type="password" required minlength="8" id="user[password]" placeholder="Create a password" autocomplete="off" spellcheck="false"></input>
            </dd>
            <dd class="error"></dd>
        </dl>
        <button id="user[create]">Sign up / Log in</button>
        <div style="max-width:280px;text-align: center;font-size:11px;margin:4px auto">
            By clicking the button above, you agree to our
            <a href="/terms" target="_blank" style="color:#36c;text-decoration:none">terms of service</a>
            and
            <a href="/privacy" target="_blank" style="color:#36c;text-decoration:none">privacy statement</a>.
        </div>
        <div style="margin:16px auto;text-align: center">— OR —</div>
        <button id="user[guest]" style="background-color: #999">Continue as Croquet Guest</button>
        <div style="max-width:250px;text-align: center;font-size:11px;margin:4px auto">Your stuff will disappear eventually.</div>
    `;
    const overlay = document.createElement("div");
    overlay.classList.add("overlay");
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const [nameInput, emailInput, passwordInput] = dialog.getElementsByTagName("input");
    const [nameError, emailError, passwordError] = dialog.getElementsByClassName("error");
    const [nameNotice] = dialog.getElementsByClassName("notice");
    const [submitButton, guestButton] = dialog.getElementsByTagName("button");

    if (typeof urlOptions.user === "string") nameInput.value = urlOptions.user;
    else if (getUser("name")) nameInput.value = getUser("name");

    // after a small timeout, check if username available
    let nameTimeout = 0;
    nameInput.oninput = () => {
        clearTimeout(nameTimeout);
        nameTimeout = setTimeout(() => checkName(), 300);
    };

    setNewUser(true);
    nameInput.oninput(); // check new user on startup

    // after a small timeout, check if email valid
    let emailTimeout = 0;
    emailInput.oninput = () => {
        clearTimeout(emailTimeout);
        emailTimeout = setTimeout(() => checkEmail(), 300);
    };

    // after a small timeout, check if password valid
    let passwordTimeout = 0;
    passwordInput.oninput = () => {
        clearTimeout(passwordTimeout);
        passwordTimeout = setTimeout(() => checkPassword(), 300);
    };

    submitButton.onclick = async evt => {
        evt.preventDefault();
        const { name, salt: existing } = await checkName(true);
        const email = !!existing || checkEmail(true);
        const password = checkPassword(true);
        if (!name || !email || !password) return;

        let salt = existing;
        if (!salt) {
            // store new salt in a known location (username/salt.json)
            // this "reserves" the username
            salt = crypto.getRandomValues(new Uint8Array(8));
            fetch(userURL(name, "salt"), {
                method: 'PUT',
                mode: "cors",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ salt: toBase64url(salt) }),
            });
        }

        // do 500,000 rounds of SHA-256 with PBKDF2 using our 64 bit salt
        const key = await window.crypto.subtle.importKey("raw", new TextEncoder().encode(password), {name: "PBKDF2"}, false, ["deriveBits"]);
        const bits = await window.crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 500000, hash: "SHA-256" }, key, 256);
        const hash = toBase64url(bits);

        if (existing) {
            // check that user record exists
            try {
                const response = await fetch(userURL(name, hash), { mode: "cors" });
                if (!response.ok) throw Error("wrong password");
                const userRecord = await response.json();
                console.log(`Logged in as ${userRecord.name} <${userRecord.email}>`);
                localStorage.croquetUser = JSON.stringify(userRecord);
            } catch (e) {
                passwordError.innerHTML = `Wrong password for “${name}“`;
                passwordError.style.visibility = "visible";
                return;
            }
        } else {
            // store user record as <user>/<hash>.json
            const secret = crypto.getRandomValues(new Uint8Array(16));
            const userRecord = { name, email, salt: toBase64url(salt), secret: toBase64url(secret) };
            localStorage.croquetUser = JSON.stringify(userRecord);
            fetch(userURL(name, hash), {
                method: 'PUT',
                mode: "cors",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(userRecord),
            });
            console.log(`Signed up as ${userRecord.name} <${userRecord.email}>`);
        }

        // close dialog
        dialog.reset(); // clear fields
        document.body.removeChild(overlay);
    };

    guestButton.onclick = evt => {
        evt.preventDefault();
        // log out
        delete localStorage.croquetUser;
        // close dialog
        dialog.reset(); // clear fields
        document.body.removeChild(overlay);
    };

    function userURL(username, file, ext=".json") {
        return `https://db.croquet.studio/files-v1/user/${username.toLowerCase()}/${file}${ext}`;
    }

    async function checkName(final=false) {
        nameError.style.visibility = "hidden";
        if (!final) setNewUser(true);
        const name = nameInput.value.trim();
        if (!name && !final) return false;
        if (nameInput.validity.tooShort || nameInput.validity.tooLong) {
            nameError.innerHTML = `Your username must be between ${nameInput.minLength} and ${nameInput.maxLength} characters long.`;
            nameError.style.visibility = "visible";
            return false;
        }
        if (nameInput.validity.patternMismatch) {
            nameError.innerHTML = "Your username can only contain alphanumeric characters (letters A-Z, numbers 0-9) and underscores.";
            nameError.style.visibility = "visible";
            return false;
        }
        try {
            const timeout = nameTimeout;
            const response = await fetch(userURL(name, "salt"), {mode: "cors"}); if (timeout !== nameTimeout && !final) return false;
            if (response.ok) {
                if (!final) setNewUser(false);
                const json = await response.json();
                return  {name, salt: fromBase64url(json.salt)};
            }
        } catch (e) { /* ignore */ }
        return {name};
    }

    function checkEmail(final=false) {
        emailError.style.visibility = "hidden";
        const email = emailInput.value.trim();
        if (!email && !final) return false;
        if (!emailInput.validity.valid) {
            emailError.innerHTML = "Please enter a valid email address.";
            emailError.style.visibility = "visible";
            return false;
        }
        return email;
    }

    function checkPassword(final=false) {
        passwordError.style.visibility = "hidden";
        const password = passwordInput.value;
        if (!password && !final) return false;
        if (passwordInput.validity.tooShort) {
            passwordError.innerHTML = `Your password must be at least ${passwordInput.minLength} characters long.`;
            passwordError.style.visibility = "visible";
            return false;
        }
        return password;
    }

    function setNewUser(isNewUser) {
        const name = nameInput.value.trim();
        nameNotice.innerHTML = `“${name}” is already registered as a user.<br><br>
            If this is you, please enter your password below to continue.
            Otherwise, please pick a different name.`;
        nameNotice.style.visibility = isNewUser ? "hidden" : "visible";
        emailInput.disabled = !isNewUser;
        passwordInput.placeholder = !name ? "Enter a password" : isNewUser ? `Create a password for “${name}”` : `Enter password for “${name}”`;
        submitButton.innerHTML = !name ? "Sign up / Log in" : isNewUser ? `Sign up as “${name}”` : `Log in as “${name}”`;
    }
}
