// Vérifie que la progression est bien verrouillée : chaque capacité est NÉCESSAIRE
// et SUFFISANTE pour passer son obstacle. Lancer : node tests/gates.test.js
const fs = require("fs"), vm = require("vm"), path = require("path"), assert = require("assert");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const code = html.match(/<script>([\s\S]*)<\/script>/)[1];
const mod = { exports: {} };
vm.runInNewContext(code, { module: mod, Math, Array, Object, console });
const G = mod.exports, { TILE, PH } = G;

function fresh(abilities = {}) {
  const s = G.newState(G.buildLevel());
  Object.assign(s.abilities, abilities);
  s.drones = []; // on teste le terrain, pas les drones
  return s;
}
function place(s, tx, ty) { s.p.x = tx * TILE + 6; s.p.y = ty * TILE + (TILE - PH); s.checkpoint = { x: s.p.x, y: s.p.y }; }
function run(s, frames, policy) {
  let prev = {};
  for (let f = 0; f < frames; f++) {
    const want = policy(s, f);
    const inp = { left: !!want.left, right: !!want.right, jumpHeld: !!want.jump, dashHeld: !!want.dash };
    inp.jump = inp.jumpHeld && !prev.jumpHeld; inp.dash = inp.dashHeld && !prev.dashHeld;
    G.step(s, inp); prev = inp;
  }
}
const results = [];
function test(name, fn) { try { fn(); results.push(["ok", name]); } catch (e) { results.push(["FAIL", name + " — " + e.message]); } }

// ---------- Fossé (cases 22-29) ----------
const GAP_RIGHT = 30 * TILE;
function gapRun(abilities, dashAtApex) {
  const s = fresh(abilities); place(s, 18, 15);
  let jumped = false, dashed = false, rose = false;
  run(s, 240, (s, f) => {
    const edge = s.p.x + 20 >= 22 * TILE - 2;
    const w = { right: true };
    if (edge && !jumped) { w.jump = true; jumped = true; }
    else if (jumped && s.p.vy < 0) w.jump = true;               // saut maximal
    if (s.p.vy < -1) rose = true;
    if (rose && dashAtApex && !dashed && s.p.vy >= -0.6) { w.dash = true; dashed = true; }
    return w;
  });
  return s;
}
test("fossé : impossible sans dash", () => {
  const s = gapRun({}, false);
  assert.ok(s.deaths > 0, "le joueur aurait dû tomber");
});
test("fossé : franchissable avec dash", () => {
  const s = gapRun({ dash: true }, true);
  assert.strictEqual(s.deaths, 0, "mort pendant le dash");
  assert.ok(s.p.x > GAP_RIGHT, "n'a pas atteint l'autre bord : x=" + s.p.x);
});

// ---------- Bloc de 5 cases (x=47, sommet ligne 11) ----------
function climb(abilities) {
  const s = fresh(abilities); place(s, 44, 15);
  s.reachedTop = false;
  run(s, 300, (s, f) => {
    if (s.p.x > 47 * TILE && s.p.y + PH <= 11 * TILE) s.reachedTop = true;
    // saute en boucle contre le mur, double saut au sommet de chaque saut
    const cycle = f % 60;
    return { right: true, jump: cycle < 18 || (cycle >= 20 && cycle < 40) };
  });
  return s;
}
test("bloc : impossible sans double saut", () => {
  const s = climb({ dash: true });
  assert.ok(!s.reachedTop, "a escaladé le bloc sans double saut");
});
test("bloc : escaladable avec double saut", () => {
  const s = climb({ dash: true, double: true });
  assert.ok(s.reachedTop, "n'a pas atteint le sommet");
});

// ---------- Pare-feu (x=68) ----------
function firewall(abilities) {
  const s = fresh(abilities); place(s, 64, 15);
  run(s, 200, () => ({ right: true }));
  return s;
}
test("pare-feu : bloque sans BREACH", () => assert.ok(firewall({}).p.x < 68 * TILE));
test("pare-feu : traversable avec BREACH", () => assert.ok(firewall({ breach: true }).p.x > 69 * TILE));

// ---------- Terminaux et défis ----------
test("chaque terminal est posé sur le sol (pas dans un mur)", () => {
  const s = fresh();
  for (const t of s.level.terminals) {
    assert.ok(!G.isSolid(s, t.tx, t.ty), "terminal " + t.id + " dans un mur");
    assert.ok(G.isSolid(s, t.tx, t.ty + 1), "terminal " + t.id + " flotte");
  }
});
test("réponses des défis", () => {
  const P = G.PUZZLES;
  assert.ok(P[1].check("dash") && P[1].check(" DASH ") && !P[1].check("GDVK"));
  assert.ok(P[2].check("saut") && !P[2].check("U0FVVA=="));
  assert.ok(P[4].check("/s3cr3t-admin/") && P[4].check("s3cr3t-admin") && !P[4].check("/tmp/"));
});
test("injection SQL : charges valides acceptées", () => {
  for (const u of ["admin'--", "admin' --", "' OR 1=1 --", "' or '1'='1", "x' OR 'a'='a", "admin'#", "'/*"])
    assert.ok(G.sqliWorks(u), "refusé à tort : " + u);
});
test("injection SQL : entrées normales refusées", () => {
  for (const u of ["admin", "root", "or 1=1", "admin' or 1=2", "' or 1=2"])
    assert.ok(!G.sqliWorks(u), "accepté à tort : " + u);
});
test("résoudre le terminal 4 termine la partie", () => {
  const s = fresh(); G.solve(s, 4); assert.ok(s.won);
});

let failed = 0;
for (const [st, n] of results) { console.log(`${st === "ok" ? "✔" : "✘"} ${n}`); if (st !== "ok") failed++; }
console.log(`\n${results.length - failed}/${results.length} tests réussis`);
process.exit(failed ? 1 : 0);
