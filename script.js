// ─────────────────────────────────────────
//  CONFIGURAÇÃO
// ─────────────────────────────────────────
const CLIENT_ID    = "26a4960d1ff049cd856ef4656003a29b";
const CLIENT_SECRET = "3cb3856472234558908489932951c911";
const REDIRECT_URI = "https://italofm.github.io/sound-energy/callback.html";

// Escopos necessários para reprodução completa
const SCOPES = [
    "streaming",
    "user-read-email",
    "user-read-private",
    "user-read-playback-state",
    "user-modify-playback-state"
].join(" ");

let accessToken    = null;
let tokenExpiresAt = 0;

// ─────────────────────────────────────────
//  TOKEN CLIENT CREDENTIALS (para API)
// ─────────────────────────────────────────
async function gerarToken() {
    const response = await fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: {
            "Authorization": "Basic " + btoa(CLIENT_ID + ":" + CLIENT_SECRET),
            "Content-Type": "application/x-www-form-urlencoded"
        },
        body: "grant_type=client_credentials"
    });
    if (!response.ok) { console.error("Erro ao gerar token:", response.status); return null; }
    const data     = await response.json();
    accessToken    = data.access_token;
    tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;
    console.log("Token gerado. Expira em:", new Date(tokenExpiresAt).toLocaleTimeString());
    return accessToken;
}

async function getToken() {
    if (!accessToken || Date.now() >= tokenExpiresAt) await gerarToken();
    return accessToken;
}

function agendarRenovacao() {
    const ms = tokenExpiresAt - Date.now();
    if (ms > 0) setTimeout(async () => { await gerarToken(); agendarRenovacao(); }, ms);
}

async function spotifyFetch(endpoint) {
    const token = await getToken();
    const r = await fetch("https://api.spotify.com/v1" + endpoint, {
        headers: { "Authorization": "Bearer " + token }
    });
    if (r.status === 401) {
        await gerarToken();
        return (await fetch("https://api.spotify.com/v1" + endpoint, {
            headers: { "Authorization": "Bearer " + accessToken }
        })).json();
    }
    return r.json();
}

// ─────────────────────────────────────────
//  TOKEN OAUTH (para reprodução)
// ─────────────────────────────────────────
function getOAuthToken() {
    return localStorage.getItem("se_oauth_token") || null;
}

async function refreshOAuthToken() {
    const refreshToken = localStorage.getItem("se_oauth_refresh");
    if (!refreshToken) return null;

    const r = await fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            grant_type:    "refresh_token",
            refresh_token: refreshToken,
            client_id:     CLIENT_ID
        })
    });

    const data = await r.json();
    if (data.access_token) {
        localStorage.setItem("se_oauth_token",      data.access_token);
        localStorage.setItem("se_oauth_expires_at", Date.now() + (data.expires_in - 60) * 1000);
        if (data.refresh_token) localStorage.setItem("se_oauth_refresh", data.refresh_token);
        return data.access_token;
    }
    return null;
}

async function getOAuthTokenValido() {
    const expiresAt = parseInt(localStorage.getItem("se_oauth_expires_at") || "0");
    if (Date.now() >= expiresAt) {
        return await refreshOAuthToken();
    }
    return getOAuthToken();
}

// ─────────────────────────────────────────
//  OAUTH PKCE — login com Spotify
// ─────────────────────────────────────────
function base64url(buffer) {
    return btoa(String.fromCharCode(...new Uint8Array(buffer)))
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

async function gerarPKCE() {
    const verifier  = base64url(crypto.getRandomValues(new Uint8Array(32)));
    const digest    = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    const challenge = base64url(digest);
    return { verifier, challenge };
}

async function loginSpotify() {
    const { verifier, challenge } = await gerarPKCE();
    localStorage.setItem("se_code_verifier", verifier);
    const url = "https://accounts.spotify.com/authorize?" + new URLSearchParams({
        client_id:             CLIENT_ID,
        response_type:         "code",
        redirect_uri:          REDIRECT_URI,
        code_challenge_method: "S256",
        code_challenge:        challenge,
        scope:                 SCOPES
    });
    window.location.href = url;
}

// ─────────────────────────────────────────
//  WEB PLAYBACK SDK
// ─────────────────────────────────────────
let spotifyPlayer = null;
let deviceId      = null;
let sdkPronto     = false;

// A SDK chama essa função globalmente quando está pronta
window.onSpotifyWebPlaybackSDKReady = async () => {
    const oauthToken = await getOAuthTokenValido();
    if (!oauthToken) {
        console.warn("SDK pronta mas sem OAuth token.");
        return;
    }

    spotifyPlayer = new Spotify.Player({
        name: "Sound Energy",
        getOAuthToken: async cb => {
            const t = await getOAuthTokenValido();
            cb(t);
        },
        volume: 0.7
    });

    spotifyPlayer.addListener("ready", ({ device_id }) => {
        deviceId  = device_id;
        sdkPronto = true;
        console.log("✅ Spotify SDK pronta. Device ID:", device_id);
        atualizarBotaoPlayer(true);
    });

    spotifyPlayer.addListener("not_ready", ({ device_id }) => {
        console.warn("SDK não disponível. Device ID:", device_id);
        sdkPronto = false;
    });

    spotifyPlayer.addListener("player_state_changed", state => {
        if (!state) return;
        const track = state.track_window.current_track;
        if (track) {
            $("#player-track-name").text(track.name);
            $("#player-track-artist").text(track.artists.map(a => a.name).join(", "));
            const img = track.album.images?.[2]?.url || track.album.images?.[0]?.url || "";
            if (img) $("#player-thumb").attr("src", img);
        }
        setIconePlay(!state.paused);
        atualizarProgressoSDK(state);
    });

    spotifyPlayer.addListener("authentication_error", ({ message }) => {
        console.error("Erro de autenticação:", message);
    });

    spotifyPlayer.addListener("account_error", ({ message }) => {
        console.error("Erro de conta:", message);
        Swal.fire({
            icon: "error",
            title: "Conta Premium necessária",
            text: "A reprodução completa requer Spotify Premium.",
            background: "#1a1a1a",
            color: "#fff",
            confirmButtonColor: "#cc0000"
        });
    });

    spotifyPlayer.connect();
};

function iniciarSDK() {
    // Se a SDK já carregou antes do JS, dispara manualmente
    if (window.Spotify) {
        window.onSpotifyWebPlaybackSDKReady();
    }
}

function atualizarBotaoPlayer(conectado) {
    if (conectado) {
        $("#player-play-btn").css("opacity", "1").css("cursor", "pointer");
    }
}

// Progresso via estado da SDK
let sdkProgressTimer = null;

function atualizarProgressoSDK(state) {
    clearInterval(sdkProgressTimer);
    if (!state || state.paused) return;

    let pos = state.position;
    const dur = state.duration;

    function tick() {
        if (dur <= 0) return;
        const pct = (pos / dur) * 100;
        $("#player-bar-fill").css("width", pct + "%");
        $("#player-bar-thumb").css("left", pct + "%");
        $("#player-current").text(msParaMinutos(pos));
        pos += 250;
        if (pos > dur) pos = dur;
    }

    tick();
    sdkProgressTimer = setInterval(tick, 250);
}

// ─────────────────────────────────────────
//  TOCAR FAIXA
// ─────────────────────────────────────────
let filaUris   = [];
let filaFaixas = [];
let tocandoIdx = -1;

async function tocarFaixa(track, idx) {
    // Atualiza UI imediatamente
    const artistas = track.artists?.map(a => a.name).join(", ") || "";
    const thumb    = track.album?.images?.[2]?.url || track.album?.images?.[0]?.url || "";
    $("#player-track-name").text(track.name);
    $("#player-track-artist").text(artistas);
    if (thumb) $("#player-thumb").attr("src", thumb);
    $(".song-row").removeClass("playing");
    $(".song-row").eq(idx).addClass("playing");
    tocandoIdx = idx;

    // Se SDK está pronta e tem OAuth, usa reprodução completa
    if (sdkPronto && deviceId) {
        const oauthToken = await getOAuthTokenValido();
        if (oauthToken && track.uri) {
            // Monta fila a partir da faixa clicada
            const uris = filaFaixas.slice(idx).map(t => t.uri).filter(Boolean);
            await fetch("https://api.spotify.com/v1/me/player/play?device_id=" + deviceId, {
                method: "PUT",
                headers: {
                    "Authorization": "Bearer " + oauthToken,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ uris: uris.slice(0, 50) })
            });
            setIconePlay(true);
            return;
        }
    }

    // Fallback: preview de 30s se disponível
    if (track.preview_url) {
        audio.pause();
        clearInterval(progressTimer);
        audio.src = track.preview_url;
        audio.volume = 0.7;
        audio.play();
        setIconePlay(true);
        progressTimer = setInterval(atualizarProgressoAudio, 250);
        audio.onended = () => {
            setIconePlay(false);
            clearInterval(progressTimer);
            if (idx + 1 < filaFaixas.length) tocarFaixa(filaFaixas[idx + 1], idx + 1);
        };
        return;
    }

    // Sem preview e sem SDK — abre no Spotify
    const url = track.external_urls?.spotify;
    if (url) window.open(url, "_blank");
}

// ─────────────────────────────────────────
//  AUDIO FALLBACK (preview 30s)
// ─────────────────────────────────────────
const audio = new Audio();
let progressTimer = null;

function atualizarProgressoAudio() {
    if (!audio.duration) return;
    const pct = (audio.currentTime / audio.duration) * 100;
    $("#player-bar-fill").css("width", pct + "%");
    $("#player-bar-thumb").css("left", pct + "%");
    $("#player-current").text(msParaMinutos(audio.currentTime * 1000));
}

// ─────────────────────────────────────────
//  CONTROLES DO PLAYER
// ─────────────────────────────────────────
function setIconePlay(tocando) {
    if (tocando) {
        $("#play-icon").html(`<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>`);
    } else {
        $("#play-icon").html(`<path d="M8 5v14l11-7z"/>`);
    }
}

function iniciarControlesPlayer() {
    // Play/Pause
    $("#player-play-btn").on("click", async function () {
        if (sdkPronto && spotifyPlayer) {
            spotifyPlayer.togglePlay();
            return;
        }
        // fallback audio
        if (audio.src && !audio.paused) {
            audio.pause();
            clearInterval(progressTimer);
            setIconePlay(false);
        } else if (audio.src) {
            audio.play();
            progressTimer = setInterval(atualizarProgressoAudio, 250);
            setIconePlay(true);
        }
    });

    // Próxima
    $("[aria-label='Próxima']").on("click", async function () {
        if (sdkPronto && spotifyPlayer) { spotifyPlayer.nextTrack(); return; }
        if (tocandoIdx + 1 < filaFaixas.length) tocarFaixa(filaFaixas[tocandoIdx + 1], tocandoIdx + 1);
    });

    // Anterior
    $("[aria-label='Anterior']").on("click", async function () {
        if (sdkPronto && spotifyPlayer) { spotifyPlayer.previousTrack(); return; }
        if (tocandoIdx > 0) tocarFaixa(filaFaixas[tocandoIdx - 1], tocandoIdx - 1);
    });

    // Barra de progresso
    $(".player-bar").on("click", async function (e) {
        const rect = this.getBoundingClientRect();
        const pct  = (e.clientX - rect.left) / rect.width;
        if (sdkPronto && spotifyPlayer) {
            const state = await spotifyPlayer.getCurrentState();
            if (state) spotifyPlayer.seek(pct * state.duration);
            return;
        }
        if (audio.duration) audio.currentTime = pct * audio.duration;
    });

    // Volume
    $(".volume-bar").on("click", function (e) {
        const rect = this.getBoundingClientRect();
        const vol  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        if (spotifyPlayer) spotifyPlayer.setVolume(vol);
        audio.volume = vol;
        $(".volume-bar-fill").css("width", (vol * 100) + "%");
        $(".volume-bar-thumb").css("left", (vol * 100) + "%");
    });
}

// ─────────────────────────────────────────
//  NAVBAR — usuário
// ─────────────────────────────────────────
function carregarUsuarioNavbar() {
    const spotifyUser = JSON.parse(localStorage.getItem("se_spotify_user") || "null");
    const localUser   = localStorage.getItem("se_usuario");

    if (spotifyUser) {
        if (spotifyUser.foto) {
            $(".navbar-avatar").html(`<img src="${spotifyUser.foto}" style="width:30px;height:30px;border-radius:50%;object-fit:cover;">`);
        } else {
            $(".navbar-avatar").text((spotifyUser.nome || "U")[0].toUpperCase());
        }
        $(".navbar-username").text(spotifyUser.nome);
    } else if (localUser) {
        $(".navbar-avatar").text(localUser[0].toUpperCase());
        $(".navbar-username").text(localUser);
    }

    $(".navbar-user").on("click", function () {
        const temOAuth = !!getOAuthToken();
        const opcoes   = temOAuth
            ? `<button id="swal-logout" class="swal-btn swal-btn-red">Sair</button>`
            : `<button id="swal-spotify" class="swal-btn swal-btn-green">🎵 Conectar Spotify Premium</button>
               <button id="swal-logout" class="swal-btn swal-btn-red">Sair</button>`;

        Swal.fire({
            title: spotifyUser ? spotifyUser.nome : (localUser || "Usuário"),
            html: `<div style="display:flex;flex-direction:column;gap:10px;margin-top:8px">${opcoes}</div>`,
            showConfirmButton: false,
            background: "#1a1a1a",
            color: "#fff",
            didOpen: () => {
                document.getElementById("swal-logout")?.addEventListener("click", () => {
                    localStorage.clear();
                    Swal.close();
                    window.location.href = "login.html";
                });
                document.getElementById("swal-spotify")?.addEventListener("click", () => {
                    Swal.close();
                    loginSpotify();
                });
            }
        });
    });
}

// ─────────────────────────────────────────
//  API — PLAYLISTS E FAIXAS
// ─────────────────────────────────────────
async function buscarPlaylistsDestaque() {
    const data  = await spotifyFetch("/search?q=Top+50&type=playlist&limit=10&market=BR");
    const todas = data?.playlists?.items?.filter(Boolean) || [];
    console.log("Playlists recebidas:", todas.length);
    const oficiais = todas.filter(pl => pl.owner?.id === "spotify");
    return (oficiais.length > 0 ? oficiais : todas).slice(0, 4);
}

const ARTISTAS_FAIXAS = [
    "3BiJGZsyX9sJchTqcSA7Su",
    "1XkoF8ryArs86LZvFOkbyr",
    "1yR65psqiazQpeM79CcGh8",
    "0EmeFodog0BfCgMzAIvKQp"
];

const delay = ms => new Promise(res => setTimeout(res, ms));

async function fetchComRetry(url, token, tentativas = 3) {
    for (let i = 0; i < tentativas; i++) {
        const r = await fetch(url, { headers: { "Authorization": "Bearer " + token } });
        if (r.status === 429) {
            const wait = (parseInt(r.headers.get("Retry-After") || "3") + 1) * 1000;
            console.warn("Rate limit. Aguardando", wait, "ms...");
            await delay(wait);
            continue;
        }
        if (!r.ok) return null;
        return r;
    }
    return null;
}

async function buscarFaixas(playlistId, playlistNome, indice = 0) {
    // Se tem OAuth token, busca direto da playlist do Spotify (1 requisição)
    const oauthToken = await getOAuthTokenValido();
    if (oauthToken) {
        const r = await fetch(
            "https://api.spotify.com/v1/playlists/" + playlistId + "/tracks?limit=20",
            { headers: { "Authorization": "Bearer " + oauthToken } }
        );
        if (r.ok) {
            const data = await r.json();
            return (data?.items || [])
                .map(item => item?.track)
                .filter(Boolean);
        }
    }

    // Fallback sem OAuth — usa artistas fixos
    const artistId = ARTISTAS_FAIXAS[indice % ARTISTAS_FAIXAS.length];
    const token    = await getToken();

    const albumsResp = await fetchComRetry(
        "https://api.spotify.com/v1/artists/" + artistId + "/albums?offset=0", token
    );
    if (!albumsResp) return [];

    const albumsData = await albumsResp.json();
    const albums     = albumsData?.items?.filter(Boolean) || [];
    if (!albums.length) return [];

    await delay(500);

    const albumId    = albums[0].id;
    const tracksResp = await fetchComRetry(
        "https://api.spotify.com/v1/albums/" + albumId + "/tracks?offset=0", token
    );
    if (!tracksResp) return [];

    const tracksData = await tracksResp.json();
    return (tracksData?.items || []).map(t => ({
        ...t,
        album: { name: albums[0].name, images: albums[0].images }
    })).filter(Boolean);
}

// ─────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────
function msParaMinutos(ms) {
    const total = Math.floor(ms / 1000);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function corDominante(imgEl, callback) {
    try {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 10;
        const ctx    = canvas.getContext("2d");
        ctx.drawImage(imgEl, 0, 0, 10, 10);
        const [r, g, b] = ctx.getImageData(4, 4, 1, 1).data;
        const dark = `rgb(${Math.floor(r*.4)},${Math.floor(g*.4)},${Math.floor(b*.4)})`;
        callback(`linear-gradient(160deg, rgb(${r},${g},${b}) 0%, ${dark} 50%, #121212 100%)`);
    } catch {
        callback("linear-gradient(160deg, #cc0000 0%, #8b0000 50%, #121212 100%)");
    }
}

// ─────────────────────────────────────────
//  RENDERIZAÇÃO
// ─────────────────────────────────────────
function renderizarSidebar(playlists) {
    const lista = $(".playlist-list");
    lista.empty();

    playlists.forEach((pl, i) => {
        const img  = pl.images?.[0]?.url || "imgs/playlist1.png";
        const nome = pl.name || "Playlist";
        const dono = pl.owner?.display_name || "Spotify";

        const item = $(`
            <li class="playlist-item ${i === 0 ? "active" : ""}"
                data-id="${pl.id}" data-img="${img}"
                data-nome="${nome}" data-dono="${dono}">
                <img src="${img}" alt="${nome}" class="playlist-thumb">
                <div class="playlist-info">
                    <span class="playlist-name">${nome}</span>
                    <span class="playlist-meta">📌 Playlist • ${dono}</span>
                </div>
            </li>
        `);
        lista.append(item);
    });

    $(".playlist-item").each((i, el) => $(el).css("animation-delay", `${0.05 + i * 0.1}s`));

    $(".playlist-item").on("click", function () {
        $(".playlist-item").removeClass("active");
        $(this).addClass("active");
        atualizarHero(
            $(this).data("id"), $(this).data("img"),
            $(this).data("nome"), $(this).data("dono"),
            $(this).index()
        );
    });
}

function atualizarHero(playlistId, imgUrl, nome, dono, indice = 0) {
    $("#playlist-hero-cover").attr("src", imgUrl).attr("alt", nome);
    $(".action-icon img").attr("src", imgUrl);
    $("#playlist-hero-title").text(nome);
    $(".hero-meta-author").text(dono);
    $(".hero-meta-stats").text("Carregando faixas...");

    const tempImg = new Image();
    tempImg.crossOrigin = "anonymous";
    tempImg.src = imgUrl;
    tempImg.onload = () => corDominante(tempImg, g => {
        $("#playlist-hero-bg").css("opacity", 0).css("background", g).animate({ opacity: 1 }, 400);
    });

    buscarFaixas(playlistId, nome, indice).then(faixas => {        filaFaixas = faixas;
        const total    = faixas.length;
        const durTotal = faixas.reduce((a, t) => a + (t?.duration_ms || 0), 0);
        const min      = Math.floor(durTotal / 60000);
        $(".hero-meta-stats").text(`${total} músicas • ${Math.floor(min/60)}h ${min%60}min`);
        renderizarFaixas(faixas);
    });
}

function renderizarFaixas(faixas) {
    $(".song-list").remove();

    const lista = $(`
        <div class="song-list">
            <div class="song-list-header">
                <span>#</span><span>Título</span><span>Álbum</span><span>⏱</span>
            </div>
        </div>
    `);

    faixas.forEach((track, i) => {
        if (!track) return;
        const artistas   = track.artists?.map(a => a.name).join(", ") || "";
        const album      = track.album?.name || "";
        const duracao    = msParaMinutos(track.duration_ms || 0);
        const temPreview = !!track.preview_url;
        const temUri     = !!track.uri;

        const row = $(`
            <div class="song-row ${(!temPreview && !temUri) ? "no-preview" : ""}"
                 title="Clique para ouvir">
                <span class="song-row-num">${i + 1}</span>
                <div class="song-row-title-wrap">
                    <span class="song-row-title">${track.name}</span>
                    <span class="song-row-artist">${artistas}</span>
                </div>
                <span class="song-row-album">${album}</span>
                <span class="song-row-time">${duracao}</span>
            </div>
        `);

        row.on("click", () => tocarFaixa(track, i));
        lista.append(row);
    });

    $(".content").append(lista);
}

// ─────────────────────────────────────────
//  ESTILOS DINÂMICOS
// ─────────────────────────────────────────
function injetarEstilos() {
    const style = document.createElement("style");
    style.textContent = `
        .song-row.playing .song-row-title { color: #cc0000; }
        .song-row.playing .song-row-num   { color: #cc0000; }
        .song-row.no-preview              { opacity: 0.45; }
        .song-row.no-preview:hover        { opacity: 0.7; }
        #player-total { color: #b3b3b3; font-size: 11px; white-space: nowrap; }
        .swal-btn { width:100%; padding:10px; border:none; border-radius:8px;
                    font-size:14px; cursor:pointer; font-family:"New Rocker",sans-serif; }
        .swal-btn-green { background: linear-gradient(135deg,#1ed760,#17b34e); color:#000; }
        .swal-btn-red   { background: linear-gradient(135deg,#cc0000,#8b0000); color:#fff; }
        .swal-btn:hover { filter: brightness(1.1); }
    `;
    document.head.appendChild(style);
}

// ─────────────────────────────────────────
//  INICIALIZAÇÃO
// ─────────────────────────────────────────
$(document).ready(async function () {
    console.log("Inicializando Sound Energy...");

    if (!localStorage.getItem("se_usuario") && !localStorage.getItem("se_spotify_user")) {
        window.location.href = "login.html";
        return;
    }

    injetarEstilos();
    carregarUsuarioNavbar();
    iniciarControlesPlayer();
    iniciarSDK();

    $("#navbar-search-input").on("keydown", function (e) {
        if (e.key === "Enter") {
            const q = $(this).val().trim();
            if (q) window.location.href = "search.html?q=" + encodeURIComponent(q);
        }
    });

    $(".player-progress .player-time:last-child").attr("id", "player-total");

    await gerarToken();
    agendarRenovacao();

    const playlists = await buscarPlaylistsDestaque();
    if (!playlists.length) { console.warn("Nenhuma playlist retornada."); return; }

    console.log(`✅ ${playlists.length} playlists carregadas:`, playlists.map(p => p.name));
    renderizarSidebar(playlists);

    // Carrega hero da primeira playlist mas SEM buscar faixas ainda
    const primeira = playlists[0];
    $("#playlist-hero-cover").attr("src", primeira.images?.[0]?.url || "imgs/playlist1.png");
    $("#playlist-hero-title").text(primeira.name);
    $(".hero-meta-author").text(primeira.owner?.display_name || "Spotify");
    $(".hero-meta-stats").text("Clique em uma playlist para ver as músicas");
    $(".playlist-item").first().addClass("active");
});
