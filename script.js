// ─────────────────────────────────────────
//  CONFIGURAÇÃO
// ─────────────────────────────────────────
const CLIENT_ID = "26a4960d1ff049cd856ef4656003a29b";
const CLIENT_SECRET = "3cb3856472234558908489932951c911";
const REDIRECT_URI = "https://italofm.github.io/sound-energy/callback/callback.html";

// Escopos necessários para reprodução completa
const SCOPES = [
    "streaming",
    "user-read-email",
    "user-read-private",
    "user-read-playback-state",
    "user-modify-playback-state",
    "playlist-read-private",
    "playlist-read-collaborative"
].join(" ");

let accessToken = null;
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
    const data = await response.json();
    accessToken = data.access_token;
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
            grant_type: "refresh_token",
            refresh_token: refreshToken,
            client_id: CLIENT_ID
        })
    });

    const data = await r.json();
    if (data.access_token) {
        localStorage.setItem("se_oauth_token", data.access_token);
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
    const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    const challenge = base64url(digest);
    return { verifier, challenge };
}

async function loginSpotify() {
    const { verifier, challenge } = await gerarPKCE();
    localStorage.setItem("se_code_verifier", verifier);
    const url = "https://accounts.spotify.com/authorize?" + new URLSearchParams({
        client_id: CLIENT_ID,
        response_type: "code",
        redirect_uri: REDIRECT_URI,
        code_challenge_method: "S256",
        code_challenge: challenge,
        scope: SCOPES
    });
    window.location.href = url;
}

// ─────────────────────────────────────────
//  WEB PLAYBACK SDK
// ─────────────────────────────────────────
let spotifyPlayer = null;
let deviceId = null;
let sdkPronto = false;

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
        deviceId = device_id;
        sdkPronto = true;
        console.log("✅ Spotify SDK pronta. Device ID:", device_id);
        atualizarBotaoPlayer(true);

        // Ativa o elemento para o Spotify reconhecer o device
        if (spotifyPlayer.activateElement) {
            spotifyPlayer.activateElement();
        }

        $("#sdk-badge").text("🟢 Conectado").removeClass("desconectado").addClass("conectado");

    });

    spotifyPlayer.addListener("not_ready", ({ device_id }) => {
        console.warn("SDK não disponível. Device ID:", device_id);
        sdkPronto = false;
        $("#sdk-badge").text("🔴 Desconectado").removeClass("conectado").addClass("desconectado");
        atualizarBotaoPlayer(false);
    });

    spotifyPlayer.addListener("player_state_changed", state => {
        if (!state) return;
        const track = state.track_window.current_track;
        if (track) {
            const nome = track.name;
            const artistas = track.artists.map(a => a.name).join(", ");
            const img = track.album.images?.[2]?.url || track.album.images?.[0]?.url || "";

            $("#player-track-name").text(nome);
            $("#player-track-artist").text(artistas);
            if (img) $("#player-thumb").attr("src", img);

            // Atualiza título da aba
            document.title = `${nome} • ${artistas} — Sound Energy`;

            // Toast de notificação
            mostrarToast(nome, artistas, img);

            // Salva no histórico de reprodução
            if (!state.paused) {
                salvarHistorico({ nome, artistas, img, uri: track.uri, timestamp: Date.now() });
            }
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
        $("#player-remaining").text("-" + msParaMinutos(dur - pos));
        pos += 250;
        if (pos > dur) pos = dur;
    }

    tick();
    sdkProgressTimer = setInterval(tick, 250);
}

// ─────────────────────────────────────────
//  TOCAR FAIXA
// ─────────────────────────────────────────
let filaUris = [];
let filaFaixas = [];
let tocandoIdx = -1;

// Detecta se está em browser mobile (SDK não suportada)
const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

// Busca o device ID do app Spotify no celular do usuário
async function getSpotifyAppDeviceId(oauthToken) {
    const r = await fetch("https://api.spotify.com/v1/me/player/devices", {
        headers: { "Authorization": "Bearer " + oauthToken }
    });
    if (!r.ok) return null;
    const data = await r.json();
    // Prioriza o device ativo, depois qualquer um disponível
    const devices = data?.devices || [];
    const ativo   = devices.find(d => d.is_active);
    return ativo?.id || devices[0]?.id || null;
}

async function tocarPlaylistMobile(playlistId, oauthToken) {
    const mobileDeviceId = await getSpotifyAppDeviceId(oauthToken);

    if (!mobileDeviceId) {
        Swal.fire({
            icon: "info",
            title: "Abra o Spotify",
            html: `<p style="color:#b3b3b3;font-size:14px">
                       Abra o app do Spotify no seu celular e tente novamente.
                       <br><br>
                       O Spotify precisa estar ativo em segundo plano.
                   </p>`,
            confirmButtonColor: "#cc0000",
            background: "#1a1a1a",
            color: "#fff"
        });
        return false;
    }

    const resp = await fetch("https://api.spotify.com/v1/me/player/play?device_id=" + mobileDeviceId, {
        method: "PUT",
        headers: { "Authorization": "Bearer " + oauthToken, "Content-Type": "application/json" },
        body: JSON.stringify({ context_uri: "spotify:playlist:" + playlistId })
    });
    console.log("Mobile play status:", resp.status);
    return resp.ok || resp.status === 204;
}

async function tocarFaixa(track, idx) {
    // Atualiza UI imediatamente
    const artistas = track.artists?.map(a => a.name).join(", ") || "";
    const thumb = track.album?.images?.[2]?.url || track.album?.images?.[0]?.url || "";
    $("#player-track-name").text(track.name);
    $("#player-track-artist").text(artistas);
    if (thumb) $("#player-thumb").attr("src", thumb);
    $(".song-row").removeClass("playing");
    $(".song-row").eq(idx).addClass("playing");
    tocandoIdx = idx;

    // Mobile — transfere para o app do Spotify
    if (isMobile) {
        const oauthToken = await getOAuthTokenValido();
        if (oauthToken && track.uri) {
            const mobileDeviceId = await getSpotifyAppDeviceId(oauthToken);
            if (mobileDeviceId) {
                const uris = filaFaixas.slice(idx).map(t => t.uri).filter(Boolean);
                await fetch("https://api.spotify.com/v1/me/player/play?device_id=" + mobileDeviceId, {
                    method: "PUT",
                    headers: { "Authorization": "Bearer " + oauthToken, "Content-Type": "application/json" },
                    body: JSON.stringify({ uris: uris.slice(0, 50) })
                });
                setIconePlay(true);
            }
        }
        return;
    }

    // Desktop — usa a SDK
    if (sdkPronto && deviceId) {
        const oauthToken = await getOAuthTokenValido();
        if (oauthToken && track.uri) {
            try {
                // Ativa o device antes de qualquer comando
                if (spotifyPlayer?.activateElement) await spotifyPlayer.activateElement();

                const uris = filaFaixas.slice(idx).map(t => t.uri).filter(Boolean);
                const body = uris.length > 0
                    ? JSON.stringify({ uris: uris.slice(0, 50) })
                    : JSON.stringify({ uris: [track.uri] });

                // Inicia direto sem transferir
                const resp = await fetch("https://api.spotify.com/v1/me/player/play?device_id=" + deviceId, {
                    method: "PUT",
                    headers: { "Authorization": "Bearer " + oauthToken, "Content-Type": "application/json" },
                    body: body
                });
                console.log("Tocar faixa status:", resp.status);
                if (resp.ok || resp.status === 204) { setIconePlay(true); return; }
            } catch (e) {
                console.error("Erro ao tocar faixa:", e);
            }
        }
    }

    // Fallback audio — também atualiza título
    if (track.preview_url) {
        audio.pause();
        clearInterval(progressTimer);
        audio.src = track.preview_url;
        audio.volume = 0.7;
        audio.play();
        setIconePlay(true);
        const artistas = track.artists?.map(a => a.name).join(", ") || "";
        document.title = `${track.name} • ${artistas} — Sound Energy`;
        progressTimer = setInterval(atualizarProgressoAudio, 250);
        audio.onended = () => {
            setIconePlay(false);
            clearInterval(progressTimer);
            document.title = "Sound Energy";
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
    $("#player-remaining").text("-" + msParaMinutos((audio.duration - audio.currentTime) * 1000));
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

// Estado de shuffle e repeat
let shuffleAtivo = false;
let repeatAtivo = false;

function iniciarControlesPlayer() {
    // Play/Pause
    $("#player-play-btn").on("click", async function () {
        if (sdkPronto && spotifyPlayer) { spotifyPlayer.togglePlay(); return; }
        if (audio.src && !audio.paused) {
            audio.pause(); clearInterval(progressTimer); setIconePlay(false);
        } else if (audio.src) {
            audio.play(); progressTimer = setInterval(atualizarProgressoAudio, 250); setIconePlay(true);
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

    // ── Shuffle ──
    $("[aria-label='Shuffle']").on("click", async function () {
        shuffleAtivo = !shuffleAtivo;
        $(this).toggleClass("btn-ativo", shuffleAtivo);
        if (sdkPronto) {
            const t = await getOAuthTokenValido();
            if (t) await fetch("https://api.spotify.com/v1/me/player/shuffle?state=" + shuffleAtivo, {
                method: "PUT", headers: { "Authorization": "Bearer " + t }
            });
        }
    });

    // ── Repeat ──
    $("[aria-label='Repetir']").on("click", async function () {
        repeatAtivo = !repeatAtivo;
        $(this).toggleClass("btn-ativo", repeatAtivo);
        if (sdkPronto) {
            const t = await getOAuthTokenValido();
            if (t) await fetch("https://api.spotify.com/v1/me/player/repeat?state=" + (repeatAtivo ? "context" : "off"), {
                method: "PUT", headers: { "Authorization": "Bearer " + t }
            });
        }
    });

    // ── Progresso — clique e drag ──
    let isDraggingProgress = false;

    function posicaoBarra(e, el) {
        const rect = el.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    }

    async function aplicarProgresso(pct) {
        if (sdkPronto && spotifyPlayer) {
            const state = await spotifyPlayer.getCurrentState();
            if (state) {
                spotifyPlayer.seek(pct * state.duration);
                // Atualiza tempo restante
                const restante = state.duration - pct * state.duration;
                $("#player-remaining").text("-" + msParaMinutos(restante));
            }
        } else if (audio.duration) {
            audio.currentTime = pct * audio.duration;
        }
    }

    $(".player-bar").on("mousedown touchstart", function (e) {
        isDraggingProgress = true;
        const pct = posicaoBarra(e, this);
        $("#player-bar-fill").css("width", (pct * 100) + "%");
        $("#player-bar-thumb").css("left", (pct * 100) + "%");
        e.preventDefault();
    });

    $(document).on("mousemove touchmove", function (e) {
        if (!isDraggingProgress) return;
        const pct = posicaoBarra(e, $(".player-bar")[0]);
        $("#player-bar-fill").css("width", (pct * 100) + "%");
        $("#player-bar-thumb").css("left", (pct * 100) + "%");
    });

    $(document).on("mouseup touchend", async function (e) {
        if (!isDraggingProgress) return;
        isDraggingProgress = false;
        await aplicarProgresso(posicaoBarra(e, $(".player-bar")[0]));
    });

    $(".player-bar").on("click", async function (e) {
        if (isDraggingProgress) return;
        await aplicarProgresso(posicaoBarra(e, this));
    });

    // ── Volume — clique e drag ──
    let isDraggingVolume = false;

    function aplicarVolume(pct) {
        const vol = Math.max(0, Math.min(1, pct));
        if (spotifyPlayer) spotifyPlayer.setVolume(vol);
        audio.volume = vol;
        $(".volume-bar-fill").css("width", (vol * 100) + "%");
        $(".volume-bar-thumb").css("left", (vol * 100) + "%");
    }

    $(".volume-bar").on("mousedown touchstart", function (e) {
        isDraggingVolume = true;
        aplicarVolume(posicaoBarra(e, this));
        e.preventDefault();
    });

    $(document).on("mousemove touchmove", function (e) {
        if (!isDraggingVolume) return;
        aplicarVolume(posicaoBarra(e, $(".volume-bar")[0]));
    });

    $(document).on("mouseup touchend", function () { isDraggingVolume = false; });

    $(".volume-bar").on("click", function (e) {
        if (isDraggingVolume) return;
        aplicarVolume(posicaoBarra(e, this));
    });
}

// ─────────────────────────────────────────
//  NAVBAR — usuário
// ─────────────────────────────────────────
function carregarUsuarioNavbar() {
    const spotifyUser = JSON.parse(localStorage.getItem("se_spotify_user") || "null");
    const localUser = localStorage.getItem("se_usuario");

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
        const opcoes = temOAuth
            ? `<button id="swal-perfil" class="swal-btn swal-btn-gray">👤 Ver Perfil</button>
               <button id="swal-spotify" class="swal-btn swal-btn-green">🔄 Reconectar Spotify</button>
               <button id="swal-logout" class="swal-btn swal-btn-red">Sair</button>`
            : `<button id="swal-perfil" class="swal-btn swal-btn-gray">👤 Ver Perfil</button>
               <button id="swal-spotify" class="swal-btn swal-btn-green">🎵 Conectar Spotify Premium</button>
               <button id="swal-logout" class="swal-btn swal-btn-red">Sair</button>`;

        Swal.fire({
            title: spotifyUser ? spotifyUser.nome : (localUser || "Usuário"),
            html: `<div style="display:flex;flex-direction:column;gap:10px;margin-top:8px">${opcoes}</div>`,
            showConfirmButton: false,
            background: "#1a1a1a",
            color: "#fff",
            didOpen: () => {
                document.getElementById("swal-perfil")?.addEventListener("click", () => {
                    Swal.close();
                    window.location.href = "PROFILLE/profile.html";
                });
                document.getElementById("swal-logout")?.addEventListener("click", () => {
                    localStorage.clear();
                    Swal.close();
                    window.location.href = "login/login.html";
                });
                document.getElementById("swal-spotify")?.addEventListener("click", () => {
                    // Limpa só o token, mantém a SDK conectada
                    localStorage.removeItem("se_oauth_token");
                    localStorage.removeItem("se_oauth_refresh");
                    localStorage.removeItem("se_oauth_expires_at");
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
// IDs fixos das playlists do usuário na ordem desejada
const PLAYLIST_IDS = [
    "4IqfA57y1Hvpybz4lBwBwe", // The ultimate universe
    "3oM0gSL5nSngOr3FHSBAy3", // A moment for me
    "2Zk2qafpWhUo12B2mfVGW1", // A mesma pessoa
    "7JwQ79zuiAdQKFat4fqXuT"  // Jovens Titans
];

async function buscarPlaylistsDestaque() {
    // Offline — usa cache do localStorage
    if (!navigator.onLine) {
        const cache = localStorage.getItem("se_playlists_cache");
        if (cache) {
            console.log("📦 Offline — carregando playlists do cache");
            mostrarBannerOffline();
            return JSON.parse(cache);
        }
        console.warn("Offline e sem cache disponível.");
        return [];
    }

    const oauthToken = await getOAuthTokenValido();
    const token = oauthToken || await getToken();

    const playlists = [];
    for (const id of PLAYLIST_IDS) {
        const r = await fetch("https://api.spotify.com/v1/playlists/" + id + "?fields=id,name,images,owner", {
            headers: { "Authorization": "Bearer " + token }
        });
        if (r.ok) {
            const data = await r.json();
            playlists.push(data);
        } else {
            console.warn("Erro ao buscar playlist " + id + ":", r.status);
        }
    }

    // Salva no cache para uso offline
    if (playlists.length > 0) {
        localStorage.setItem("se_playlists_cache", JSON.stringify(playlists));
        console.log("✅ Playlists salvas no cache offline");
    }

    console.log("Playlists carregadas:", playlists.map(p => p.name));
    return playlists;
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
    // Offline — usa cache de faixas
    if (!navigator.onLine) {
        const cacheFaixas = JSON.parse(localStorage.getItem("se_faixas_cache") || "{}");
        if (cacheFaixas[playlistId]) {
            console.log("📦 Faixas do cache offline:", playlistId);
            return cacheFaixas[playlistId];
        }
        return [];
    }
    const oauthToken = await getOAuthTokenValido();

    // Tenta buscar faixas da playlist com OAuth
    if (oauthToken) {
        const r = await fetch(
            "https://api.spotify.com/v1/playlists/" + playlistId + "/tracks?limit=50",
            { headers: { "Authorization": "Bearer " + oauthToken } }
        );
        console.log("Status faixas OAuth:", r.status, playlistId);
        if (r.ok) {
            const data = await r.json();
            const faixas = (data?.items || []).map(item => item?.track).filter(t => t && t.name);
            if (faixas.length > 0) return faixas;
        }
    }

    // Fallback — busca álbuns do artista via IDs fixos
    const token = await getToken();
    const artistId = ARTISTAS_FAIXAS[indice % ARTISTAS_FAIXAS.length];

    const albumsResp = await fetchComRetry(
        "https://api.spotify.com/v1/artists/" + artistId + "/albums?offset=0", token
    );
    if (!albumsResp) return [];

    const albumsData = await albumsResp.json();
    const albums = albumsData?.items?.filter(Boolean) || [];
    if (!albums.length) return [];

    await delay(300);

    const tracksResp = await fetchComRetry(
        "https://api.spotify.com/v1/albums/" + albums[0].id + "/tracks?offset=0", token
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
        const ctx = canvas.getContext("2d");
        ctx.drawImage(imgEl, 0, 0, 10, 10);
        const [r, g, b] = ctx.getImageData(4, 4, 1, 1).data;
        const dark = `rgb(${Math.floor(r * .4)},${Math.floor(g * .4)},${Math.floor(b * .4)})`;
        callback(`linear-gradient(160deg, rgb(${r},${g},${b}) 0%, ${dark} 50%, #121212 100%)`);
    } catch {
        callback("linear-gradient(160deg, #cc0000 0%, #8b0000 50%, #121212 100%)");
    }
}

// ─────────────────────────────────────────
//  MODO OFFLINE
// ─────────────────────────────────────────
function mostrarBannerOffline() {
    // Evita mostrar múltiplas vezes
    if ($("#offline-banner").length) return;

    $("body").prepend(`
        <div id="offline-banner" style="
            position: fixed;
            top: 56px;
            left: 0;
            width: 100%;
            background: #8b0000;
            color: #fff;
            text-align: center;
            padding: 8px 16px;
            font-size: 13px;
            z-index: 999;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
        ">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2">
                <path d="M1 1l22 22M16.72 11.06A10.94 10.94 0 0 1 19 12.55M5 12.55a10.94 10.94 0 0 1 5.17-2.39M10.71 5.05A16 16 0 0 1 22.56 9M1.42 9a15.91 15.91 0 0 1 4.7-2.88M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01"/>
            </svg>
            Você está offline — exibindo dados salvos
        </div>
    `);

    // Ajusta o margin-top do app-wrapper para compensar o banner
    $(".app-wrapper").css("margin-top", "88px");
}

function esconderBannerOffline() {
    $("#offline-banner").remove();
    $(".app-wrapper").css("margin-top", "56px");
}

// ─────────────────────────────────────────
//  RENDERIZAÇÃO
// ─────────────────────────────────────────
function renderizarSidebar(playlists) {
    const lista = $(".playlist-list");
    lista.empty();

    playlists.forEach((pl, i) => {
        const img = pl.images?.[0]?.url || "imgs/playlist1.png";
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
    // Animação de loading no hero
    $("#playlist-hero-cover").addClass("hero-loading");
    $(".song-list").remove();
    $(".hero-meta-stats").text("Carregando faixas...");

    // Pequeno delay para a animação aparecer antes de atualizar
    setTimeout(() => {
        $("#playlist-hero-cover").attr("src", imgUrl).attr("alt", nome);
        $("#playlist-hero-cover").removeClass("hero-loading");
    }, 200);

    $(".action-icon img").attr("src", imgUrl);
    $("#playlist-hero-title").text(nome);
    $(".hero-meta-author").text(dono);

    // Botão play do hero toca a playlist inteira
    $(".action-play").off("click").on("click", async () => {
        const oauthToken = await getOAuthTokenValido();
        if (!oauthToken) { loginSpotify(); return; }

        // Mobile — usa o app do Spotify em vez da SDK
        if (isMobile) {
            setIconePlay(true);
            const ok = await tocarPlaylistMobile(playlistId, oauthToken);
            if (!ok) setIconePlay(false);
            return;
        }

        // Desktop — usa a SDK
        if (!sdkPronto || !deviceId) {
            Swal.fire({
                icon: "info",
                title: "Player não conectado",
                text: "Conecte o Spotify Premium pelo avatar e tente novamente.",
                background: "#1a1a1a",
                color: "#fff",
                confirmButtonColor: "#cc0000",
                timer: 3000,
                showConfirmButton: false
            });
            return;
        }

        try {
            if (spotifyPlayer?.activateElement) await spotifyPlayer.activateElement();

            const resp = await fetch("https://api.spotify.com/v1/me/player/play?device_id=" + deviceId, {
                method: "PUT",
                headers: { "Authorization": "Bearer " + oauthToken, "Content-Type": "application/json" },
                body: JSON.stringify({ context_uri: "spotify:playlist:" + playlistId })
            });
            console.log("Play status:", resp.status);

            if (resp.status === 404) {
                // Device inativo — transfere e tenta novamente
                console.warn("Device inativo, transferindo...");
                await fetch("https://api.spotify.com/v1/me/player", {
                    method: "PUT",
                    headers: { "Authorization": "Bearer " + oauthToken, "Content-Type": "application/json" },
                    body: JSON.stringify({ device_ids: [deviceId], play: true })
                });
                await delay(1500);
                // Tenta tocar novamente
                const resp2 = await fetch("https://api.spotify.com/v1/me/player/play?device_id=" + deviceId, {
                    method: "PUT",
                    headers: { "Authorization": "Bearer " + oauthToken, "Content-Type": "application/json" },
                    body: JSON.stringify({ context_uri: "spotify:playlist:" + playlistId })
                });
                console.log("Play retry status:", resp2.status);
                if (resp2.ok || resp2.status === 204) setIconePlay(true);
            } else if (resp.ok || resp.status === 204) {
                setIconePlay(true);
            }

        } catch (e) {
            console.error("Erro ao tocar playlist:", e);
        }
    });

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
        $(".hero-meta-stats").text(`${total} músicas • ${Math.floor(min / 60)}h ${min % 60}min`);
        renderizarFaixas(faixas);

        // Salva faixas no cache offline
        if (navigator.onLine && faixas.length > 0) {
            const cacheFaixas = JSON.parse(localStorage.getItem("se_faixas_cache") || "{}");
            cacheFaixas[playlistId] = faixas;
            localStorage.setItem("se_faixas_cache", JSON.stringify(cacheFaixas));
        }
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
        const artistas = track.artists?.map(a => a.name).join(", ") || "";
        const album = track.album?.name || "";
        const duracao = msParaMinutos(track.duration_ms || 0);
        const temPreview = !!track.preview_url;
        const temUri = !!track.uri;

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
        .swal-btn:hover { filter: brightness(1.15); }
    `;
    document.head.appendChild(style);
}

// ─────────────────────────────────────────
//  HISTÓRICO DE REPRODUÇÃO
// ─────────────────────────────────────────
function salvarHistorico(entrada) {
    const historico = JSON.parse(localStorage.getItem("se_historico") || "[]");

    // Evita duplicata consecutiva da mesma música
    if (historico.length > 0 && historico[0].uri === entrada.uri) return;

    historico.unshift(entrada);
    localStorage.setItem("se_historico", JSON.stringify(historico.slice(0, 30)));
}

// ─────────────────────────────────────────
//  TOAST DE NOTIFICAÇÃO
// ─────────────────────────────────────────
let toastTimer = null;

function mostrarToast(nome, artista, img) {
    $("#toast-title").text(nome);
    $("#toast-artist").text(artista);
    $("#toast-img").attr("src", img);
    $("#toast-player").addClass("show");

    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        $("#toast-player").removeClass("show");
    }, 3000);
}

// ─────────────────────────────────────────
//  INICIALIZAÇÃO
// ─────────────────────────────────────────
$(document).ready(async function () {
    // Registra o Service Worker para PWA
    if ("serviceWorker" in navigator) {
        navigator.serviceWorker.register("/sound-energy/service-worker.js")
            .then(() => console.log("✅ Service Worker registrado"))
            .catch(e => console.warn("SW erro:", e));
    }

    // Banner de instalação do PWA
    let deferredPrompt = null;

    window.addEventListener("beforeinstallprompt", (e) => {
        e.preventDefault();
        deferredPrompt = e;

        // Só mostra se o usuário ainda não instalou
        if (!localStorage.getItem("se_pwa_installed")) {
            setTimeout(() => {
                Swal.fire({
                    title: "📱 Instalar Sound Energy",
                    html: `<p style="color:#b3b3b3;font-size:14px;margin-top:8px">
                               Instale o app na sua tela inicial e acesse com um toque, sem abrir o browser.
                           </p>`,
                    showCancelButton: true,
                    confirmButtonText: "Instalar",
                    cancelButtonText: "Agora não",
                    confirmButtonColor: "#cc0000",
                    cancelButtonColor: "#2a2a2a",
                    background: "#1a1a1a",
                    color: "#fff",
                    imageUrl: "imgs/2243c3de-9ed4-4bf6-8874-9e36f36f4d09.png",
                    imageWidth: 80,
                    imageHeight: 80,
                    imageAlt: "Sound Energy"
                }).then((result) => {
                    if (result.isConfirmed && deferredPrompt) {
                        deferredPrompt.prompt();
                        deferredPrompt.userChoice.then((choice) => {
                            if (choice.outcome === "accepted") {
                                localStorage.setItem("se_pwa_installed", "1");
                                console.log("✅ PWA instalado");
                            }
                            deferredPrompt = null;
                        });
                    }
                });
            }, 3000); // Aguarda 3s para não aparecer imediatamente
        }
    });

    // Detecta quando já foi instalado
    window.addEventListener("appinstalled", () => {
        localStorage.setItem("se_pwa_installed", "1");
        deferredPrompt = null;
        console.log("✅ PWA instalado com sucesso");
    });

    console.log("Inicializando Sound Energy...");

    // Listeners de conexão
    window.addEventListener("online", () => {
        console.log("✅ Conexão restaurada");
        esconderBannerOffline();
    });

    window.addEventListener("offline", () => {
        console.log("📴 Conexão perdida");
        mostrarBannerOffline();
    });

    // Mostra banner se já estiver offline ao entrar
    if (!navigator.onLine) mostrarBannerOffline();

    if (!localStorage.getItem("se_usuario") && !localStorage.getItem("se_spotify_user")) {
        window.location.href = "login/login.html";
        return;
    }

    injetarEstilos();
    carregarUsuarioNavbar();
    iniciarControlesPlayer();
    iniciarSDK();

    $("#navbar-search-input").on("keydown", function (e) {
        if (e.key === "Enter") {
            const q = $(this).val().trim();
            if (q) window.location.href = "search/search.html?q=" + encodeURIComponent(q);
        }
    });

    // Mobile drawer — abre/fecha sidebar
    $("#mobile-menu-btn").on("click", function () {
        $(".sidebar").addClass("open");
        $(".sidebar-overlay").addClass("active");
    });

    $("#sidebar-overlay").on("click", function () {
        $(".sidebar").removeClass("open");
        $(".sidebar-overlay").removeClass("active");
    });

    // Fecha drawer ao clicar numa playlist
    $(document).on("click", ".playlist-item", function () {
        $(".sidebar").removeClass("open");
        $(".sidebar-overlay").removeClass("active");
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
