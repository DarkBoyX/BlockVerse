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
