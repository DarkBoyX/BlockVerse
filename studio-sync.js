/* BlockVerse Studio -> cloud world sync.
   Loaded by studio.html (one <script src="studio-sync.js"> line). It looks at the games saved by Studio on this
   computer, and for every game that is pending review or published it uploads a compact copy of the world
   (parts, colours, shapes, scripts) to Firebase at game_worlds/<gameId>. The home page loads that copy when
   someone presses Play. It re-uploads automatically whenever you change the world, so a published game
   stays up to date while you build.
   A small message appears in the bottom-left corner of Studio telling you whether the upload worked. */
(function(){
  "use strict";
  var tries = 0;
  (function waitForFirebase(){
    if(window.firebase && firebase.apps && firebase.apps.length) return boot();
    if(++tries > 60) return note("World sync: Firebase never loaded, so worlds can't upload.", true);
    setTimeout(waitForFirebase, 500);
  })();

  var noteEl = null, noteTimer = null;
  function note(msg, bad){
    try{ (bad ? console.warn : console.log)("[studio-sync] " + msg); }catch(e){}
    try{
      if(!noteEl){
        noteEl = document.createElement("div");
        noteEl.style.cssText = "position:fixed;left:14px;bottom:14px;z-index:2147483000;max-width:380px;padding:9px 13px;border-radius:9px;font:12px/1.4 'Segoe UI',system-ui,sans-serif;color:#fff;box-shadow:0 8px 22px rgba(0,0,0,.5);pointer-events:none";
        document.body.appendChild(noteEl);
      }
      noteEl.textContent = msg;
      noteEl.style.background = bad ? "#7a2a2a" : "#1f5a37";
      noteEl.style.border = "1px solid " + (bad ? "#d4504f" : "#3ecf6e");
      noteEl.style.display = "block";
      clearTimeout(noteTimer);
      noteTimer = setTimeout(function(){ noteEl.style.display = "none"; }, bad ? 20000 : 6000);
    }catch(e){}
  }

  function boot(){
    var db = firebase.database();
    var auth = firebase.auth();
    var PREFIX = "bv_studio_games_";
    var lastSent = {};            // gameId -> the exact text last uploaded
    var busy = false;
    var publishedIds = {};        // gameId -> true, for games an admin has published
    note("World sync is on (checking your games...)");

    function pack(w){
      var parts = (w.parts || []).map(function(p){
        var pr = p.props || {};
        return {
          i: p.id, n: p.name, c: p.className, s: p.shape,
          p: pr.position, r: pr.rotation, z: pr.size,
          k: pr.color, m: pr.material, t: pr.transparency || 0,
          cc: pr.canCollide === false ? 0 : 1,
          cs: pr.castShadow === false ? 0 : 1
        };
      });
      return JSON.stringify({ v: 1, parts: parts, nodes: w.nodes || [], light: w.light || null });
    }

    // a game that was never opened in the editor has no saved world yet: it is just Studio's default scene
    function defaultWorld(){
      return { parts: [
        { name: "Baseplate", className: "Part", shape: "cube", props: { position: [0, -0.5, 0], rotation: [0, 0, 0], size: [100, 1, 100], color: 0x3ecf6e, material: "plastic", transparency: 0, canCollide: true, castShadow: true } },
        { name: "SpawnLocation", className: "SpawnLocation", shape: "cube", props: { position: [0, 0.15, 0], rotation: [0, 0, 0], size: [6, 0.3, 6], color: 0xc23b3b, material: "plastic", transparency: 0, canCollide: true, castShadow: true } }
      ] };
    }

    function gamesToSync(){
      var out = [];
      for(var i = 0; i < localStorage.length; i++){
        var k = localStorage.key(i);
        if(!k || k.indexOf(PREFIX) !== 0) continue;
        var owner = k.slice(PREFIX.length), list;
        try{ list = JSON.parse(localStorage.getItem(k) || "[]"); }catch(e){ continue; }
        (list || []).forEach(function(g){
          if(!g || !g.id) return;
          var live = g.publishStatus === "published" || g.publishStatus === "pending" || publishedIds[g.id];
          if(!live) return;
          var real = !!(g.world && g.world.parts);
          out.push({ owner: owner, game: g, world: real ? g.world : defaultWorld(), fallback: !real });
        });
      }
      return out;
    }

    function refreshPublished(){
      try{
        var url = firebase.app().options.databaseURL + "/published_games.json?shallow=true";
        return fetch(url).then(function(r){ return r.json(); }).then(function(j){ publishedIds = j || {}; }).catch(function(){});
      }catch(e){ return Promise.resolve(); }
    }

    function ensureAuth(){
      if(auth.currentUser) return Promise.resolve();
      return auth.signInAnonymously().then(function(){});
    }

    function sync(){
      if(busy) return;
      busy = true;
      refreshPublished().then(function(){
        var all = gamesToSync();
        if(!all.length){ busy = false; return; }
        var todo = all.map(function(e){ return { owner: e.owner, id: e.game.id, name: e.game.name, fallback: e.fallback, data: pack(e.world) }; })
          .filter(function(e){ return lastSent[e.id] !== e.data; });
        if(!todo.length){ busy = false; return; }
        return ensureAuth().then(function(){
          return todo.reduce(function(chain, e){
            return chain.then(function(){
              if(e.data.length > 3000000){ note("\"" + (e.name || e.id) + "\" is too big to upload (over 3 MB).", true); return; }
              var write = function(){
                return db.ref("game_worlds/" + e.id).set({
                  ownerKey: e.owner,
                  ts: firebase.database.ServerValue.TIMESTAMP,
                  data: e.data
                }).then(function(){ lastSent[e.id] = e.data; note("World uploaded: \"" + (e.name || e.id) + "\" is ready to join from the home page."); });
              };
              if(!e.fallback) return write();
              // no saved world on this device: only fill in the default scene if the cloud has nothing yet,
              // so a real world uploaded from another device is never overwritten
              return db.ref("game_worlds/" + e.id + "/ownerKey").once("value").then(function(s){
                if(s.exists()){ lastSent[e.id] = e.data; return; }
                return write();
              });
            }).catch(function(err){
              var code = err && (err.code || err.message) || String(err);
              note("World upload failed for \"" + (e.name || e.id) + "\": " + code + (/permission/i.test(code) ? " - paste the new database rules in Firebase and press Publish." : ""), true);
            });
          }, Promise.resolve());
        });
      }).catch(function(err){
        note("World sync error: " + (err && (err.code || err.message) || err), true);
      }).then(function(){ busy = false; });
    }

    window.bvSyncNow = sync;
    setTimeout(sync, 3000);
    setInterval(sync, 15000);
    document.addEventListener("click", function(e){
      var t = e.target;
      if(t && t.closest && t.closest("#gsPublishBtn")) setTimeout(sync, 1500);
    }, true);
  }
})();


/* ===================================================================================================
   Editor menu: the "<" back button in the editor becomes a hamburger menu with
   Publish for review / Publish update / Take offline / Close.
   It needs the one-line hook in studio.html (window.__bvStudio = {...}) that exposes a few Studio functions.
   =================================================================================================== */
(function(){
  "use strict";
  var panel = null, backBtn = null;

  function S(){ return window.__bvStudio; }

  function closeMenu(){ if(panel){ panel.remove(); panel = null; } document.removeEventListener("mousedown", onOutside, true); document.removeEventListener("keydown", onKey, true); }
  function onOutside(e){ if(panel && !panel.contains(e.target) && e.target !== backBtn && !backBtn.contains(e.target)) closeMenu(); }
  function onKey(e){ if(e.key === "Escape") closeMenu(); }

  function item(label, sub, enabled, onClick, danger){
    var b = document.createElement("button");
    b.type = "button";
    b.disabled = !enabled;
    b.style.cssText = "display:block;width:100%;text-align:left;padding:10px 12px;margin:0 0 6px;border-radius:9px;border:1px solid rgba(255,255,255,0.12);background:" +
      (danger ? "rgba(229,72,77,0.12)" : "rgba(255,255,255,0.06)") + ";color:" + (enabled ? (danger ? "#ff8b8f" : "#f2f2f4") : "#6f6f77") +
      ";cursor:" + (enabled ? "pointer" : "not-allowed") + ";font:600 13px 'Segoe UI',system-ui,sans-serif";
    b.innerHTML = '<div>' + label + '</div>' + (sub ? '<div style="font-weight:500;font-size:11.5px;color:#8a8a92;margin-top:2px">' + sub + '</div>' : "");
    if(enabled) b.addEventListener("click", onClick);
    return b;
  }

  function openMenu(){
    if(panel){ closeMenu(); return; }
    var st = S().status();
    panel = document.createElement("div");
    panel.style.cssText = "position:fixed;left:12px;top:54px;z-index:2147482000;width:290px;padding:12px;border-radius:13px;background:#101013;border:1px solid rgba(255,255,255,0.14);box-shadow:0 18px 44px rgba(0,0,0,0.6);font-family:'Segoe UI',system-ui,sans-serif;color:#f2f2f4";
    var label = { draft: "Draft - not published", pending: "Waiting on admin review", published: "Live on the home page", denied: "Denied - fix it and resubmit" }[st] || "Draft";
    var head = document.createElement("div");
    head.style.cssText = "margin:0 0 10px;font-size:12px;color:#a8a8b0";
    head.innerHTML = '<div style="font-weight:800;font-size:14px;color:#fff;margin-bottom:3px">Game menu</div>Status: ' + label;
    panel.appendChild(head);

    var canSubmit = st !== "pending" && st !== "published";
    panel.appendChild(item(st === "denied" ? "Resubmit for review" : "Publish for review",
      st === "pending" ? "Already sent - waiting on an admin" : st === "published" ? "This game is already published" : "Send this game to the admins to be reviewed",
      canSubmit, function(){
        closeMenu();
        S().submit().then(function(r){
          if(r.ok){ S().toast("Sent for review. You'll see it update here once an admin decides."); return; }
          S().toast(r.msg || "Couldn't submit.");
          if(r.settings) S().openSettings();
        }).catch(function(err){ console.error(err); S().toast("Couldn't submit - check your connection and try again."); });
      }));

    panel.appendChild(item("Publish update",
      st === "published" ? "Save and push your latest changes to the live game" : "Only for games that are already published",
      st === "published", function(){
        closeMenu();
        S().save();
        if(typeof window.bvSyncNow === "function") window.bvSyncNow();
        S().toast("Update published. Players who join from now on get your latest version.");
      }));

    if(st === "published"){
      panel.appendChild(item("Take game offline", "Removes it from the home page and sends everyone inside back to the dashboard", true, function(){
        closeMenu();
        S().takeOffline();
      }, true));
    }

    panel.appendChild(item("Close", "Save and go back to the dashboard", true, function(){
      closeMenu();
      backBtn.dataset.bvClose = "1";
      backBtn.click();
      delete backBtn.dataset.bvClose;
    }));

    document.body.appendChild(panel);
    document.addEventListener("mousedown", onOutside, true);
    document.addEventListener("keydown", onKey, true);
  }

  function setup(){
    backBtn = document.getElementById("editorBackBtn");
    if(!backBtn || !S()) return false;
    if(backBtn.dataset.bvMenu) return true;
    backBtn.dataset.bvMenu = "1";
    backBtn.title = "Menu";
    backBtn.setAttribute("aria-label", "Menu");
    backBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';
    // runs before Studio's own click handler, which is kept for the "Close" item
    backBtn.addEventListener("click", function(e){
      if(backBtn.dataset.bvClose === "1") return;
      e.stopImmediatePropagation(); e.preventDefault();
      openMenu();
    }, true);
    return true;
  }

  var tries = 0;
  (function wait(){
    if(setup()) return;
    if(++tries < 40) setTimeout(wait, 500);
  })();
})();
