import urlOptions from "@croquet/util/urlOptions";


const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }


const DEBUG = {
    user: urlOptions.has("debug", "user", false),
};


// presistent storage of user settings
export function getUser(key, defaultValue=undefined, initFn=null) {
    const dev = JSON.parse(localStorage.croquetUser || "{}");
    if (key in dev) return dev[key];
    if (initFn) {
        dev[key] = initFn();
        if (dev[key] !== defaultValue) localStorage.croquetUser = JSON.stringify(dev);
        return dev[key];
    }
    return defaultValue;
}


// login user
if (!getUser("name") && DEBUG.user) {
    const style = document.createElement("style");
    style.innerHTML = `
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
    `;
    document.head.appendChild(style);

    const dialog = document.createElement("form");
    dialog.innerHTML = `
        <dl>
            <dt><label for="user[name]">Username</label></dt>
            <dd>
                <input type="text" pattern="^[a-zA-Z0-9_]*$" name="user[name]" id="user[name]" placeholder="Pick a username" autocomplete="off" spellcheck="false"></input>
            </dd>
            <dd class="error">
                error message
            </dd>
        </dl>
        <dl>
            <dt><label for="user[email]">Email</label></dt>
            <dd>
                <input type="email" id="user[email]" placeholder="you@example.com" autocomplete="off" spellcheck="false"></input>
            </dd>
            <dd class="error">
                error message
            </dd>
        </dl>
        <dl>
            <dt><label for="user[password]">Password</label></dt>
            <dd>
                <input type="password" id="user[password]" placeholder="Create a password" autocomplete="off" spellcheck="false"></input>
            </dd>
        </dl>
        <button id="user[create]">Create Croquet Credentials</button>
        <div style="max-width:280px;text-align: center;font-size:11px;margin:4px auto">
            By clicking “Create Croquet Credentials”,<br>
            you agree to our
            <a href="/terms" target="_blank" style="color:#36c;text-decoration:none">terms of service</a>
            and
            <a href="/privacy" target="_blank" style="color:#36c;text-decoration:none">privacy statement</a>.
        </div>
        <div style="margin:16px auto;text-align: center">— OR —</div>
        <button id="user[guest]" style="background-color: #999">Continue as Croquet Guest</button>
        <div style="max-width:250px;text-align: center;font-size:11px;margin:4px auto">Your stuff will disappear eventually.</div>
    `;
    const overlay = document.createElement("div");
    overlay.setAttribute("style", `
        z-index:10000; position:absolute; width:100vw; height:100vh;
        background-color:#333; opacity:0.9;
        display:flex; align-items:center; justify-content:center`);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const [name, email, password] = dialog.getElementsByTagName("input");
    const [nameError, emailError] = dialog.getElementsByClassName("error");
    const [create, guest] = dialog.getElementsByTagName("button");
    console.log({name, nameError, email, emailError, password, create, guest});

    // after a small timeout, check if username available
    let nameTimeout = 0;
    name.oninput = () => {
        clearTimeout(nameTimeout);
        nameTimeout = setTimeout(() => checkName(), 300);
    };

    async function checkName() {
        console.log("Checking", name.value);
        nameError.style.visibility = "hidden";
        const userName = name.value.trim();
        if (!userName) return false;
        if (!userName.match(/^[a-z0-9_]*$/i)) {
            nameError.innerHTML = "Your username can only contain alphanumeric characters (letters A-Z, numbers 0-9) with the exception of underscores.";
            nameError.style.visibility = "visible";
            return false;
        }
        if (userName.length < 2|| userName.length > 15) {
            nameError.innerHTML = "Your username must be between 2 and 15 characters long.";
            nameError.style.visibility = "visible";
            return false;
        }
        try {
            const timeout = nameTimeout;
            const saltUrl = `https://db.croquet.studio/files-v1/user/${userName.toLowerCase()}/salt.json`;
            const response = await fetch(saltUrl, {mode: "cors"}); if (timeout !== nameTimeout) return false;
            if (response.ok) {
                nameError.innerHTML = "This username is already taken";
                nameError.style.visibility = "visible";
                return false;
            }
        } catch (e) { /* ignore */ }
        return true;
    }
}
