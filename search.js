// ─────────────────────────────────────────
//  TOKEN
// ─────────────────────────────────────────
const CLIENT_ID     = "26a4960d1ff049cd856ef4656003a29b";
const CLIENT_SECRET = "3cb3856472234558908489932951c911";
let accessToken    = null;
let tokenExpiresAt = 0;

async function gerarToken() {
    const response = await fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: {
            "Authorization": "Basic " + btoa(CLIENT_ID + ":" + CLIENT_SECRET),
            "Content-Type": "application/x-www-form-urlencoded"
        },
        body: "grant_type=client_credentials"
    });
    const data = await response.json();
    accessToken    = data.access_token;
    tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;
    setTimeout(gerarToken, (data.expires_in - 60) * 1000);
}

async function getToken() {
    if (!accessToken || Date.now() >= tokenExpiresAt) await gerarToken();
    return accessToken;
}

async function spotifyGet(endpoint) {
    const token = await getToken();
    const url = "https://api.spotify.com/v1" + endpoint;
    const r = await fetch(url, { headers: { "Authorization": "Bearer " + token } });
    if (!r.ok) { console.warn("Spotify erro", r.status, url); return null; }
    return r.json();
}

// ─────────────────────────────────────────
//  PLAYER DE ÁUDIO
// ─────────────────────────────────────────
let audioPlayer = new Audio();
let tocandoIndex = -1;

function tocarFaixa(previewUrl, trackIndex, spotifyUrl) {
    if (!previewUrl) {
        // sem preview — abre no Spotify
        window.open(spotifyUrl, "_blank");
        return;
    }

    if (tocandoIndex === trackIndex && !audioPlayer.paused) {
        // pausa se já está tocando
        audioPlayer.pause();
        atualizarIconePlay(trackIndex, false);
        tocandoIndex = -1;
        return;
    }

    // para faixa anterior
    audioPlayer.pause();
    if (tocandoIndex !== -1) atualizarIconePlay(tocandoIndex, false);

    audioPlayer.src = previewUrl;
    audioPlayer.volume = 0.8;
    audioPlayer.play();
    tocandoIndex = trackIndex;
    atualizarIconePlay(trackIndex, true);

    // ao terminar, reseta ícone
    audioPlayer.onended = () => {
        atualizarIconePlay(trackIndex, false);
        tocandoIndex = -1;
    };
}

function atualizarIconePlay(index, tocando) {
    const row = $(".track-row").eq(index);
    if (tocando) {
        row.addClass("playing");
        row.find(".track-num").hide();
        row.find(".track-play").show();
        row.find(".track-play").html(`
            <svg width="14" height="14" viewBox="0 0 24 24" fill="#cc0000">
                <rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>
            </svg>
        `);
    } else {
        row.removeClass("playing");
        row.find(".track-num").show();
        row.find(".track-play").hide();
        row.find(".track-play").html(`
            <svg width="14" height="14" viewBox="0 0 16 16" fill="#fff">
                <path d="M3 2.5l10 5.5-10 5.5V2.5z"/>
            </svg>
        `);
    }
}

// ─────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────
function msParaMinutos(ms) {
    const s = Math.floor(ms / 1000);
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
}

function formatFollowers(n) {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M seguidores";
    if (n >= 1_000)     return (n / 1_000).toFixed(0) + "K seguidores";
    return n + " seguidores";
}

function corDominante(imgEl, callback) {
    try {
        const c = document.createElement("canvas");
        c.width = c.height = 10;
        const ctx = c.getContext("2d");
        ctx.drawImage(imgEl, 0, 0, 10, 10);
        const [r, g, b] = ctx.getImageData(4, 4, 1, 1).data;
        const dark = `rgb(${Math.floor(r*.35)},${Math.floor(g*.35)},${Math.floor(b*.35)})`;
        callback(`linear-gradient(160deg, rgb(${r},${g},${b}) 0%, ${dark} 45%, #121212 100%)`);
    } catch {
        callback("linear-gradient(160deg, #cc0000 0%, #8b0000 45%, #121212 100%)");
    }
}

// ─────────────────────────────────────────
//  ESTADOS DA UI
// ─────────────────────────────────────────
function mostrarEstado(estado) {
    $("#search-empty").hide();
    $("#search-loading").hide();
    $("#search-result").hide();
    if (estado === "empty")   $("#search-empty").show();
    if (estado === "loading") $("#search-loading").show();
    if (estado === "result")  $("#search-result").show();
}

// ─────────────────────────────────────────
//  BUSCA DE ARTISTA
// ─────────────────────────────────────────
async function buscarArtista(query) {
    audioPlayer.pause();
    tocandoIndex = -1;
    mostrarEstado("loading");

    const data = await spotifyGet(
        "/search?q=" + encodeURIComponent(query) + "&type=artist&limit=1&market=BR"
    );

    const artista = data?.artists?.items?.[0];
    if (!artista) {
        mostrarEstado("empty");
        Swal.fire({
            icon: "warning",
            title: "Nenhum artista encontrado",
            text: "Tente outro nome.",
            background: "#1a1a1a",
            color: "#fff",
            confirmButtonColor: "#cc0000"
        });
        return;
    }

    renderizarArtista(artista);
    await buscarAlbuns(artista.id);
}

// ─────────────────────────────────────────
//  RENDERIZAR ARTISTA
// ─────────────────────────────────────────
function renderizarArtista(artista) {
    const img       = artista.images?.[0]?.url || "";
    const nome      = artista.name || "";
    const followers = formatFollowers(artista.followers?.total || 0);
    const generos   = (artista.genres || []).slice(0, 3).join(" • ");

    $("#artist-avatar").attr("src", img).attr("alt", nome);
    $("#artist-name").text(nome);
    $("#artist-followers").text(followers);
    $("#artist-genres").text(generos);

    if (img) {
        const tempImg = new Image();
        tempImg.crossOrigin = "anonymous";
        tempImg.src = img;
        tempImg.onload = () => corDominante(tempImg, g => $("#artist-banner-bg").css("background", g));
    }

    mostrarEstado("result");
    $("#tracks-section").hide();
    $("#albums-grid").empty();
}

// ─────────────────────────────────────────
//  BUSCAR E RENDERIZAR ÁLBUNS
// ─────────────────────────────────────────
async function buscarAlbuns(artistId) {
    const data = await spotifyGet("/artists/" + artistId + "/albums?offset=0");
    const albums = data?.items || [];
    const grid   = $("#albums-grid");
    grid.empty();

    // remove duplicatas pelo nome
    const vistos = new Set();
    const unicos = albums.filter(a => {
        const key = a.name.toLowerCase();
        if (vistos.has(key)) return false;
        vistos.add(key);
        return true;
    });

    unicos.forEach((album, i) => {
        const img  = album.images?.[1]?.url || album.images?.[0]?.url || "";
        const nome = album.name || "";
        const ano  = (album.release_date || "").substring(0, 4);
        const tipo = album.album_type === "single" ? "Single" : "Álbum";
        const delay = Math.min(i * 0.06, 0.6);

        const card = $(`
            <div class="album-card" style="animation-delay:${delay}s">
                <img src="${img}" alt="${nome}" class="album-cover">
                <button class="album-play-btn" aria-label="Reproduzir">
                    <svg width="18" height="18" viewBox="0 0 16 16" fill="white">
                        <path d="M3 2.5l10 5.5-10 5.5V2.5z"/>
                    </svg>
                </button>
                <div class="album-name">${nome}</div>
                <div class="album-year">${ano} • ${tipo}</div>
            </div>
        `);

        card.on("click", () => buscarFaixas(album.id, nome, img));
        card.find(".album-play-btn").on("click", function(e) {
            e.stopPropagation();
            buscarFaixas(album.id, nome, img);
        });

        grid.append(card);
    });
}

// ─────────────────────────────────────────
//  BUSCAR E RENDERIZAR FAIXAS
// ─────────────────────────────────────────
async function buscarFaixas(albumId, albumNome, albumImg) {
    audioPlayer.pause();
    tocandoIndex = -1;

    const data   = await spotifyGet("/albums/" + albumId + "/tracks?offset=0");
    const faixas = data?.items || [];
    const lista  = $("#tracks-list");
    lista.empty();

    faixas.forEach((track, i) => {
        const duracao    = msParaMinutos(track.duration_ms || 0);
        const artistas   = (track.artists || []).map(a => a.name).join(", ");
        const preview    = track.preview_url || null;
        const spotifyUrl = track.external_urls?.spotify || "#";
        const temPreview = !!preview;

        const row = $(`
            <div class="track-row ${temPreview ? "" : "no-preview"}" title="${temPreview ? "Clique para ouvir" : "Abrir no Spotify"}">
                <div class="track-num-wrap">
                    <span class="track-num">${i + 1}</span>
                    <span class="track-play" style="display:none">
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="#fff">
                            <path d="M3 2.5l10 5.5-10 5.5V2.5z"/>
                        </svg>
                    </span>
                </div>
                <div>
                    <div class="track-title">${track.name}</div>
                    <div class="track-artist">${artistas}</div>
                </div>
                <div class="track-right">
                    ${!temPreview ? `<a href="${spotifyUrl}" target="_blank" class="spotify-link" title="Abrir no Spotify">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="#1ed760">
                            <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm4.586 14.424a.622.622 0 0 1-.857.207c-2.348-1.435-5.304-1.76-8.785-.964a.622.622 0 1 1-.277-1.215c3.809-.87 7.076-.496 9.713 1.115a.623.623 0 0 1 .206.857zm1.223-2.722a.78.78 0 0 1-1.072.257C14.1 12.257 10.763 11.82 8.16 12.6a.779.779 0 1 1-.453-1.489c2.943-.896 6.607-.462 9.13 1.091a.78.78 0 0 1 .257 1.072zm.105-2.835C15.007 9.232 10.985 9.1 8.48 9.873a.937.937 0 1 1-.543-1.79c2.877-.874 7.664-.705 10.69 1.12a.937.937 0 0 1-.713 1.664z"/>
                        </svg>
                    </a>` : ""}
                    <span class="track-duration">${duracao}</span>
                </div>
            </div>
        `);

        row.on("click", function(e) {
            if ($(e.target).closest(".spotify-link").length) return;
            tocarFaixa(preview, i, spotifyUrl);
        });

        lista.append(row);
    });

    $("#tracks-title").text(albumNome);
    $("#tracks-section").show();
    $("html, body").animate({ scrollTop: $("#tracks-section").offset().top - 70 }, 400);
}

// ─────────────────────────────────────────
//  INICIALIZAÇÃO
// ─────────────────────────────────────────
$(document).ready(async function () {
    await gerarToken();
    mostrarEstado("empty");

    $("#search-input").on("keydown", function (e) {
        if (e.key === "Enter") {
            const query = $(this).val().trim();
            if (query.length > 0) buscarArtista(query);
        }
    });

    $("#back-btn").on("click", function () {
        audioPlayer.pause();
        tocandoIndex = -1;
        $("#tracks-section").hide();
        $("html, body").animate({ scrollTop: 0 }, 300);
    });

    const params = new URLSearchParams(window.location.search);
    const q = params.get("q");
    if (q) {
        $("#search-input").val(q);
        buscarArtista(q);
    }
});
