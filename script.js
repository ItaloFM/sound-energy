// ─────────────────────────────────────────
//  CONFIGURAÇÃO
// ─────────────────────────────────────────
const CLIENT_ID     = "26a4960d1ff049cd856ef4656003a29b";
const CLIENT_SECRET = "3cb3856472234558908489932951c911";
const REDIRECT_URI  = window.location.origin + "/callback.html";

let accessToken    = null;
let tokenExpiresAt = 0;

// ─────────────────────────────────────────
//  TOKEN CLIENT CREDENTIALS
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
//  OAUTH PKCE
// ─────────────────────────────────────────
function base64url(buffer) {
    return btoa(String.fromCharCode(...new Uint8Array(buffer)))
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

async function gerarPKCE() {
    const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
    const digest   = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    const challenge = base64url(digest);
    return { verifier, challenge };
}

async function loginSpotify() {
    const { verifier, challenge } = await gerarPKCE();
    localStorage.setItem("se_code_verifier", verifier);
    const scopes = "user-read-private user-read-email";
    const url = "https://accounts.spotify.com/authorize?" + new URLSearchParams({
        client_id:             CLIENT_ID,
        response_type:         "code",
        redirect_uri:          REDIRECT_URI,
        code_challenge_method: "S256",
        code_challenge:        challenge,
        scope:                 scopes
    });
    window.location.href = url;
}

// ─────────────────────────────────────────
//  NAVBAR — usuário
// ─────────────────────────────────────────
function carregarUsuarioNavbar() {
    // Tenta usar dados do Spotify OAuth primeiro
    const spotifyUser = JSON.parse(localStorage.getItem("se_spotify_user") || "null");
    const localUser   = localStorage.getItem("se_usuario");

    if (spotifyUser) {
        const inicial = (spotifyUser.nome || "U")[0].toUpperCase();
        if (spotifyUser.foto) {
            $(".navbar-avatar").html(`<img src="${spotifyUser.foto}" style="width:30px;height:30px;border-radius:50%;object-fit:cover;">`);
        } else {
            $(".navbar-avatar").text(inicial);
        }
        $(".navbar-username").text(spotifyUser.nome);
    } else if (localUser) {
        $(".navbar-avatar").text(localUser[0].toUpperCase());
        $(".navbar-username").text(localUser);
    }

    // Clique no avatar — logout ou conectar Spotify
    $(".navbar-user").on("click", function () {
        const opcoes = spotifyUser
            ? `<button id="swal-logout" class="swal-btn swal-btn-red">Sair</button>`
            : `<button id="swal-spotify" class="swal-btn swal-btn-green">🎵 Conectar Spotify</button>
               <button id="swal-logout" class="swal-btn swal-btn-red">Sair</button>`;

        Swal.fire({
            title: spotifyUser ? spotifyUser.nome : (localUser || "Usuário"),
            html: `<div style="display:flex;flex-direction:column;gap:10px;margin-top:8px">${opcoes}</div>`,
            showConfirmButton: false,
            background: "#1a1a1a",
            color: "#fff",
            didOpen: () => {
                document.getElementById("swal-logout")?.addEventListener("click", () => {
                    localStorage.removeItem("se_usuario");
                    localStorage.removeItem("se_spotify_user");
                    localStorage.removeItem("se_oauth_token");
                    localStorage.removeItem("se_oauth_refresh");
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
//  PLAYER DE ÁUDIO
// ─────────────────────────────────────────
const audio = new Audio();
let tocandoIdx    = -1;
let filaFaixas    = [];
let progressTimer = null;

function tocarFaixa(track, idx) {
    const preview = track.preview_url;

    // Atualiza info no player independente de ter preview
    const artistas = track.artists?.map(a => a.name).join(", ") || "";
    const thumb    = track.album?.images?.[2]?.url || track.album?.images?.[0]?.url || "";

    $("#player-track-name").text(track.name);
    $("#player-track-artist").text(artistas);
    if (thumb) $("#player-thumb").attr("src", thumb);
    $("#player-total").text(msParaMinutos(track.duration_ms || 0));

    // Destaca linha na lista
    $(".song-row").removeClass("playing");
    $(".song-row").eq(idx).addClass("playing");

    if (!preview) {
        // Sem preview — abre no Spotify e simula estado parado
        const url = track.external_urls?.spotify;
        if (url) window.open(url, "_blank");
        setIconePlay(false);
        return;
    }

    // Para faixa anterior
    audio.pause();
    clearInterval(progressTimer);

    audio.src = preview;
    audio.volume = parseFloat($("#volume-range").val() || 0.7);
    audio.play();
    tocandoIdx = idx;
    setIconePlay(true);

    // Progresso em tempo real
    progressTimer = setInterval(atualizarProgresso, 250);

    audio.onended = () => {
        setIconePlay(false);
        clearInterval(progressTimer);
        $("#player-bar-fill").css("width", "0%");
        $("#player-bar-thumb").css("left", "0%");
        $("#player-current").text("0:00");
        // toca próxima automaticamente
        if (filaFaixas.length > 0 && idx + 1 < filaFaixas.length) {
            tocarFaixa(filaFaixas[idx + 1], idx + 1);
        }
    };
}

function atualizarProgresso() {
    if (!audio.duration) return;
    const pct = (audio.currentTime / audio.duration) * 100;
    $("#player-bar-fill").css("width", pct + "%");
    $("#player-bar-thumb").css("left", pct + "%");
    $("#player-current").text(msParaMinutos(audio.currentTime * 1000));
}

function setIconePlay(tocando) {
    if (tocando) {
        $("#play-icon").html(`<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>`);
    } else {
        $("#play-icon").html(`<path d="M8 5v14l11-7z"/>`);
    }
}

// ─────────────────────────────────────────
//  CONTROLES DO PLAYER
// ─────────────────────────────────────────
function iniciarControlesPlayer() {
    // Play/Pause
    $("#player-play-btn").on("click", function () {
        if (audio.src && !audio.paused) {
            audio.pause();
            clearInterval(progressTimer);
            setIconePlay(false);
        } else if (audio.src) {
            audio.play();
            progressTimer = setInterval(atualizarProgresso, 250);
            setIconePlay(true);
        }
    });

    // Barra de progresso — clique para buscar posição
    $(".player-bar").on("click", function (e) {
        if (!audio.duration) return;
        const rect = this.getBoundingClientRect();
        const pct  = (e.clientX - rect.left) / rect.width;
        audio.currentTime = pct * audio.duration;
        atualizarProgresso();
    });

    // Volume
    $(".volume-bar").on("click", function (e) {
        const rect = this.getBoundingClientRect();
        const vol  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        audio.volume = vol;
        $(".volume-bar-fill").css("width", (vol * 100) + "%");
        $(".volume-bar-thumb").css("left", (vol * 100) + "%");
    });

    // Botão próxima
    $("[aria-label='Próxima']").on("click", function () {
        if (tocandoIdx >= 0 && tocandoIdx + 1 < filaFaixas.length) {
            tocarFaixa(filaFaixas[tocandoIdx + 1], tocandoIdx + 1);
        }
    });

    // Botão anterior
    $("[aria-label='Anterior']").on("click", function () {
        if (tocandoIdx > 0) {
            tocarFaixa(filaFaixas[tocandoIdx - 1], tocandoIdx - 1);
        } else if (audio.currentTime > 3) {
            audio.currentTime = 0;
        }
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
    "3BiJGZsyX9sJchTqcSA7Su", // Gusttavo Lima
    "1XkoF8ryArs86LZvFOkbyr", // Wesley Safadão
    "1yR65psqiazQpeM79CcGh8", // Marília Mendonça
    "0EmeFodog0BfCgMzAIvKQp"  // Zé Neto & Cristiano
];

const delay = ms => new Promise(res => setTimeout(res, ms));

async function fetchComRetry(url, token, tentativas = 3) {
    for (let i = 0; i < tentativas; i++) {
        const r = await fetch(url, { headers: { "Authorization": "Bearer " + token } });
        if (r.status === 429) {
            const wait = (parseInt(r.headers.get("Retry-After") || "3") + 1) * 1000;
            console.warn(`Rate limit (429). Aguardando ${wait}ms...`);
            await delay(wait);
            continue;
        }
        if (!r.ok) return null;
        return r;
    }
    return null;
}

async function buscarFaixas(playlistId, playlistNome, indice = 0) {
    const artistId = ARTISTAS_FAIXAS[indice % ARTISTAS_FAIXAS.length];
    const token    = await getToken();

    const albumsResp = await fetchComRetry(
        "https://api.spotify.com/v1/artists/" + artistId + "/albums?offset=0", token
    );
    if (!albumsResp) return [];

    const albumsData = await albumsResp.json();
    const albums     = albumsData?.items?.filter(Boolean) || [];
    if (!albums.length) return [];

    // pequeno delay entre requisições para não bater no rate limit
    await delay(300);

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

    buscarFaixas(playlistId, nome, indice).then(faixas => {
        filaFaixas = faixas;
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
        const artistas  = track.artists?.map(a => a.name).join(", ") || "";
        const album     = track.album?.name || "";
        const duracao   = msParaMinutos(track.duration_ms || 0);
        const temPreview = !!track.preview_url;

        const row = $(`
            <div class="song-row ${temPreview ? "" : "no-preview"}"
                 title="${temPreview ? "Clique para ouvir prévia" : "Sem prévia disponível"}">
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
//  ESTILOS DINÂMICOS PARA O PLAYER
// ─────────────────────────────────────────
function injetarEstilosPlayer() {
    const style = document.createElement("style");
    style.textContent = `
        .song-row.playing .song-row-title { color: #cc0000; }
        .song-row.playing .song-row-num   { color: #cc0000; }
        .song-row.no-preview              { opacity: 0.55; }
        .song-row.no-preview:hover        { opacity: 0.8; }
        #player-total                     { color: #b3b3b3; font-size: 11px; white-space: nowrap; }
        .swal-btn { width:100%; padding:10px; border:none; border-radius:8px;
                    font-size:14px; cursor:pointer; font-family:"New Rocker",sans-serif; }
        .swal-btn-green { background:#1ed760; color:#000; }
        .swal-btn-red   { background:#cc0000; color:#fff; }
        .swal-btn:hover { filter: brightness(1.1); }
    `;
    document.head.appendChild(style);
}

// ─────────────────────────────────────────
//  INICIALIZAÇÃO
// ─────────────────────────────────────────
$(document).ready(async function () {
    console.log("Inicializando Sound Energy...");

    // Redireciona para login se não estiver logado
    if (!localStorage.getItem("se_usuario") && !localStorage.getItem("se_spotify_user")) {
        window.location.href = "login.html";
        return;
    }

    injetarEstilosPlayer();
    carregarUsuarioNavbar();
    iniciarControlesPlayer();

    // Redireciona para busca ao pressionar Enter na navbar
    $("#navbar-search-input").on("keydown", function (e) {
        if (e.key === "Enter") {
            const q = $(this).val().trim();
            if (q) window.location.href = "search.html?q=" + encodeURIComponent(q);
        }
    });

    // Adiciona tempo total ao player
    $(".player-progress .player-time:last-child").attr("id", "player-total");

    await gerarToken();
    agendarRenovacao();

    const playlists = await buscarPlaylistsDestaque();

    if (!playlists.length) {
        console.warn("Nenhuma playlist retornada.");
        return;
    }

    console.log(`✅ ${playlists.length} playlists carregadas:`, playlists.map(p => p.name));
    renderizarSidebar(playlists);

    const primeira = playlists[0];
    atualizarHero(
        primeira.id,
        primeira.images?.[0]?.url || "imgs/playlist1.png",
        primeira.name,
        primeira.owner?.display_name || "Spotify"
    );
});
