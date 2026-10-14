/* BlockVerse Studio -> cloud world sync.
   Loaded by studio.html (one <script src="studio-sync.js"> line). It looks at the games saved by Studio on this
   computer, and for every game that is pending review or published it uploads a compact copy of the world
   (parts, colours, shapes, spawn) to Firebase at game_worlds/<gameId>. The home page loads that copy when
   someone presses Play. It re-uploads automatically whenever you change the world, so a published game
   stays up to date while you build. */
(function(){
  "use strict";
  if(!window.firebase || !firebase.apps || !firebase.apps.length){
    // Studio sets Firebase up first; if it isn't ready yet, try again shortly
    var tries = 0;
    var wait = setInterval(function(){
      if(window.firebase && firebase.apps && firebase.apps.length){ clearInterval(wait); boot(); }
      else if(++tries > 40){ clearInterval(wait); }
    }, 500);
    return;
  }
  boot();

  function boot(){
    var db = firebase.database();
    var auth = firebase.auth();
    var PREFIX = "bv_studio_games_";
    var lastSent = {};            // gameId -> the exact text last uploaded
    var busy = false;

    function pack(w){
      var parts = (w.parts || []).map(function(p){
        var pr = p.props || {};
        return {
          n: p.name, c: p.className, s: p.shape,
          p: pr.position, r: pr.rotation, z: pr.size,
          k: pr.color, m: pr.material, t: pr.transparency || 0,
          cc: pr.canCollide === false ? 0 : 1,
          cs: pr.castShadow === false ? 0 : 1
        };
      });
      return JSON.stringify({ v: 1, parts: parts, light: w.light || null });
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
          if(g && g.id && (g.publishStatus === "published" || g.publishStatus === "pending")){
            out.push({ owner: owner, game: g, world: (g.world && g.world.parts) ? g.world : defaultWorld() });
          }
        });
      }
      return out;
    }

    function ensureAuth(){
      if(auth.currentUser) return Promise.resolve();
      return auth.signInAnonymously().then(function(){});
    }

    function sync(){
      if(busy) return;
      var todo = gamesToSync().map(function(e){ return { owner: e.owner, id: e.game.id, data: pack(e.world) }; })
        .filter(function(e){ return lastSent[e.id] !== e.data; });
      if(!todo.length) return;
      busy = true;
      ensureAuth().then(function(){
        return todo.reduce(function(chain, e){
          return chain.then(function(){
            if(e.data.length > 3000000){ console.warn("[studio-sync] world for", e.id, "is too large to upload"); return; }
            return db.ref("game_worlds/" + e.id).set({
              ownerKey: e.owner,
              ts: firebase.database.ServerValue.TIMESTAMP,
              data: e.data
            }).then(function(){ lastSent[e.id] = e.data; });
          });
        }, Promise.resolve());
      }).catch(function(err){
        console.warn("[studio-sync] upload failed:", err && (err.code || err.message) || err);
      }).then(function(){ busy = false; });
    }

    setTimeout(sync, 3000);
    setInterval(sync, 15000);
    // pressing "Submit for Review" should get the world up straight away
    document.addEventListener("click", function(e){
      var t = e.target;
      if(t && t.closest && t.closest("#gsPublishBtn")) setTimeout(sync, 1500);
    }, true);
  }
})();
