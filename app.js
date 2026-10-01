"use strict";

// Bring Your Own Pollen: the player signs in with Pollinations (OAuth + PKCE,
// browser only, no client secret, no backend) and their Pollen pays for the
// views they open.
const CLIENT_ID = "pk_lYDauxwBTh0s16SH";
const REDIRECT = location.origin + location.pathname;
const AUTH_URL = "https://enter.pollinations.ai/authorize";
const TOKEN_URL = "https://enter.pollinations.ai/api/oauth/token";

const b64u = (buf) => btoa(String.fromCharCode.apply(null, new Uint8Array(buf)))
  .replace(/\+/g, "-").split("/").join("_").replace(/=+$/, "");
const randB = (n) => { const a = new Uint8Array(n); crypto.getRandomValues(a); return b64u(a); };
const s256 = async (v) => b64u(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)));

let token = sessionStorage.getItem("pw_token") || "";
let login = sessionStorage.getItem("pw_login") || "";

async function signIn() {
  const verifier = randB(32);
  const state = randB(16);
  sessionStorage.setItem("pkce_v", verifier);
  sessionStorage.setItem("pkce_s", state);
  const q = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT,
    scope: "profile usage",
    state: state,
    code_challenge: await s256(verifier),
    code_challenge_method: "S256"
  });
  location.href = AUTH_URL + "?" + q.toString();
}

function authStatus() {
  const signin = document.getElementById("signin");
  const s = document.getElementById("status");
  if (token) {
    s.textContent = "Signed in as " + (login || "you") + " — every view you open is drawn with your own Pollen.";
    if (signin) signin.textContent = "Sign out";
  } else {
    s.textContent = "Sign in with Pollinations — your own Pollen pays for the postcards you draw.";
    if (signin) signin.textContent = "Sign in with Pollinations";
  }
}

function onSignin() {
  if (token) {
    token = ""; login = "";
    sessionStorage.removeItem("pw_token");
    sessionStorage.removeItem("pw_login");
    authStatus();
    return;
  }
  signIn();
}

async function handleCallback() {
  const u = new URL(location.href);
  const code = u.searchParams.get("code");
  if (!code) return;
  const want = sessionStorage.getItem("pkce_s");
  if (want && u.searchParams.get("state") !== want) { authStatus(); return; }
  try {
    const r = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: code,
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT,
        code_verifier: sessionStorage.getItem("pkce_v") || ""
      })
    });
    const d = await r.json();
    if (!d.access_token) throw new Error(d.error_description || d.error || "no access_token");
    token = d.access_token;
    sessionStorage.setItem("pw_token", token);
    sessionStorage.removeItem("pkce_v");
    sessionStorage.removeItem("pkce_s");
    history.replaceState({}, "", REDIRECT + location.hash);
    try {
      const p = await fetch("https://gen.pollinations.ai/account/profile", { headers: { Authorization: "Bearer " + token } });
      const pd = await p.json();
      login = pd.name || pd.githubUsername || "";
      sessionStorage.setItem("pw_login", login);
    } catch (e) {}
  } catch (e) {}
  authStatus();
}


const IMAGE_MODEL = "flux";
const STYLE = ", illustrated postcard, soft painterly light, limited palette, no text, no watermark";
const W = 900, H = 600;

// Three ways on, fixed positions so the click feels like a place in the picture.
const SPOTS = [
  { id: "door",   icon: "\u{1F6AA}", label: "through the door on the left",    x: 11, y: 55 },
  { id: "path",   icon: "\u{1F6E4}", label: "along the path ahead",            x: 46, y: 76 },
  { id: "window", icon: "\u{1FAA9}", label: "out of the window on the right",  x: 77, y: 33 },
];

const DETAILS = [
  "morning light", "a light drizzle", "warm evening glow", "a stray cat watching",
  "wind moving the leaves", "lanterns just lit", "footprints in the dust",
  "birds taking off", "distant bells", "mist over the ground", "a paper kite",
  "long shadows", "steam from a kettle", "puddles holding the sky",
];

const SCENES = [
  "a lighthouse at dusk, wild sea", "a sleepy fishing village at dawn",
  "a greenhouse full of ferns", "a desert bus stop on the longest road",
  "a treehouse after rain", "a bakery on a canal at night",
  "a ruined observatory under stars", "a tram stop in a rainy city",
  "a rooftop garden above the traffic", "a library inside a cave",
];

const $ = (id) => document.getElementById(id);
let world = { scene: "", seed: 1, route: [] };
let current = { prompt: "", url: "" };

// A route plus the seed always rebuilds the same prompt, so replay links work.
function promptFor(scene, route, seed) {
  let p = scene;
  route.forEach((id, i) => {
    const spot = SPOTS.find((s) => s.id === id);
    if (!spot) return;
    p += ", seen " + spot.label + ", " + DETAILS[(seed + i * 3) % DETAILS.length];
  });
  return p + STYLE;
}

const cache = new Map();

function imageUrl(prompt, seed, w, h) {
  return "https://gen.pollinations.ai/image/" + encodeURIComponent(prompt) +
    "?width=" + w + "&height=" + h + "&seed=" + seed + "&model=" + IMAGE_MODEL + "&nologo=true";
}

// Each view is paid for by the player's own Pollen, so images are fetched with
// the player's token and handed to the page as object URLs.
async function loadImage(prompt, w, h) {
  const key = prompt + "|" + w + "x" + h;
  if (!cache.has(key)) {
    cache.set(key, (async () => {
      const r = await fetch(imageUrl(prompt, world.seed, w, h), { headers: { Authorization: "Bearer " + token } });
      if (!r.ok) throw new Error("image " + r.status);
      return URL.createObjectURL(await r.blob());
    })());
  }
  return cache.get(key);
}

function viewFor(route) {
  return { prompt: promptFor(world.scene, route, world.seed) };
}

function drawSpots() {
  const box = $("spots");
  box.innerHTML = "";
  SPOTS.forEach((s) => {
    const b = document.createElement("button");
    b.className = "spot";
    b.textContent = s.icon + " " + s.label.replace(/^(through|along|out of) /, "");
    b.style.left = s.x + "%";
    b.style.top = s.y + "%";
    b.title = "Step " + s.label;
    b.onclick = () => step(s.id);
    box.appendChild(b);
  });
}

function drawTrail() {
  const el = $("trail");
  el.innerHTML = "";
  for (let i = 0; i <= world.route.length; i++) {
    const v = viewFor(world.route.slice(0, i));
    const t = document.createElement("div");
    t.className = "tile" + (i === world.route.length ? " here" : "");
    const img = document.createElement("img");
    loadImage(v.prompt, 208, 136).then((src) => { img.src = src; }).catch(() => {});
    img.alt = "view " + (i + 1);
    const label = document.createElement("span");
    label.textContent = i === 0 ? "the scene you typed" : SPOTS.find((s) => s.id === world.route[i - 1]).label;
    t.append(img, label);
    t.onclick = () => jumpTo(i);
    el.appendChild(t);
  }
  el.scrollLeft = el.scrollWidth;
}

function caption() {
  const n = world.route.length;
  if (!n) return "View 1 — " + world.scene;
  const last = SPOTS.find((s) => s.id === world.route[n - 1]);
  return "View " + (n + 1) + " — " + last.label;
}

function render() {
  const v = viewFor(world.route);
  current = v;
  const img = $("view");
  $("loading").hidden = false;
  $("spots").innerHTML = "";
  loadImage(v.prompt, W, H).then((src) => {
    img.onload = () => {
      $("loading").hidden = true;
      drawSpots();
      preloadNext();
    };
    img.src = src;
  }).catch((e) => {
    $("loading").textContent = "could not draw this view (" + e.message + ") — try again";
  });
  $("caption").textContent = caption();
  $("back").disabled = world.route.length === 0;
  drawTrail();
  saveHash();
}

function preloadNext() {
  SPOTS.forEach((s) => {
    const v = viewFor(world.route.concat(s.id));
    loadImage(v.prompt, W, H).catch(() => {});
  });
}

function step(id) {
  world.route = world.route.concat(id);
  render();
}

function jumpTo(i) {
  world.route = world.route.slice(0, i);
  render();
}

function start(scene) {
  const text = (scene || "").trim();
  if (!text) return;
  if (!token) { authStatus(); signIn(); return; }
  world = { scene: text, seed: 1 + Math.floor(Math.random() * 100000), route: [] };
  $("stage").hidden = false;
  $("status").textContent = "Drawing your first postcard with the Pollinations image API (free tier, no sign-in needed).";
  render();
}

function saveHash() {
  if (!world.scene) return;
  const payload = { s: world.scene, d: world.seed, r: world.route };
  const hash = "#w=" + btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
  history.replaceState(null, "", hash);
}

function loadHash() {
  const m = location.hash.match(/^#w=(.+)$/);
  if (!m) return false;
  try {
    const p = JSON.parse(decodeURIComponent(escape(atob(m[1]))));
    if (!p || !p.s) return false;
    world = {
      scene: p.s,
      seed: p.d || 1,
      route: Array.isArray(p.r) ? p.r.filter((x) => SPOTS.some((s) => s.id === x)) : [],
    };
    $("scene").value = world.scene;
    $("stage").hidden = false;
    $("status").textContent = "Replaying a shared route — " + (world.route.length + 1) + " postcards in.";
    render();
    return true;
  } catch (e) {
    return false;
  }
}

function copyLink(btn) {
  const url = location.href;
  const done = () => { const t = btn.textContent; btn.textContent = "Link copied ✓"; setTimeout(() => (btn.textContent = t), 1400); };
  if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, done);
  else done();
}

$("go").onclick = () => start($("scene").value);
$("scene").addEventListener("keydown", (e) => { if (e.key === "Enter") start($("scene").value); });
$("surprise").onclick = () => {
  const pick = SCENES[Math.floor(Math.random() * SCENES.length)];
  $("scene").value = pick;
  start(pick);
};
$("back").onclick = () => jumpTo(Math.max(0, world.route.length - 1));
$("replay").onclick = (e) => copyLink(e.currentTarget);
$("scene").value = SCENES[Math.floor(Math.random() * SCENES.length)];

loadHash();
document.getElementById("signin").onclick = onSignin;
authStatus();
handleCallback();
