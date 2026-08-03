// ─────────────────────────────────────────
//  TOKEN OAUTH
// ─────────────────────────────────────────
const CLIENT_ID = "26a4960d1ff049cd856ef4656003a29b";

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

async function getOAuthToken() {
    const expiresAt = parseInt(localStorage.getItem("se_oauth_expires_at") || "0");
    if (Date.now() >= expiresAt) return await refreshOAuthToken();
    return localStorage.getItem("se_oauth_token") || null;
}

async function spotifyGet(endpoint) {
    const token = await getOAuthToken();
    if (!token) return null;
    const r = await fetch("https://api.spotify.com/v1" + endpoint, {
        headers: { "Authorization": "Bearer " + token }
    });
    if (!r.ok) { console.warn("Spotify erro:", r.status, endpoint); return null; }
    return r.json();
}

// ─────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────
function formatFollowers(n) {
    if (!n) return "";
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
//  CARREGAR PERFIL
// ─────────────────────────────────────────
async function carregarPerfil() {
    // Dados do Spotify salvos no localStorage
    const spotifyUser = JSON.parse(localStorage.getItem("se_spotify_user") || "null");
    const localUser   = localStorage.getItem("se_usuario");

    // Navbar
    if (spotifyUser?.foto) {
        $("#navbar-avatar").html(`<img src="${spotifyUser.foto}" style="width:30px;height:30px;border-radius:50%;object-fit:cover;">`);
    } else {
        const inicial = (spotifyUser?.nome || localUser || "U")[0].toUpperCase();
        $("#navbar-avatar").text(inicial);
    }
    $("#navbar-username").text(spotifyUser?.nome || localUser || "Perfil");

    // Clique no avatar — voltar para início
    $("#navbar-user").on("click", () => window.location.href = "index.html");

    // Se tem usuário do Spotify, usa dados dele
    if (spotifyUser) {
        $("#profile-name").text(spotifyUser.nome);
        document.title = `${spotifyUser.nome} — Sound Energy`;

        // Foto de perfil
        if (spotifyUser.foto) {
            $("#profile-avatar").attr("src", spotifyUser.foto).show();
            $("#profile-avatar-placeholder").hide();

            // Gradiente a partir da foto
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.src = spotifyUser.foto;
            img.onload = () => corDominante(img, g => $("#profile-banner-bg").css("background", g));
        }

        // Busca dados completos via API
        const me = await spotifyGet("/me");
        if (me) {
            $("#profile-followers").text(formatFollowers(me.followers?.total));
            $("#profile-plan").text(me.product === "premium" ? "Premium" : "Gratuito");
        }
    } else if (localUser) {
        $("#profile-name").text(localUser);
        document.title = `${localUser} — Sound Energy`;
        $("#profile-plan").text("Conta Local");
    }
}

// ─────────────────────────────────────────
//  CARREGAR PLAYLISTS
// ─────────────────────────────────────────
async function carregarPlaylists() {
    const data = await spotifyGet("/me/playlists?limit=20");
    const playlists = data?.items?.filter(Boolean) || [];
    const grid = $("#profile-playlists");
    grid.empty();

    if (playlists.length === 0) {
        grid.html('<p style="color:#b3b3b3;font-size:14px;">Nenhuma playlist encontrada.</p>');
        return;
    }

    playlists.forEach((pl, i) => {
        const img   = pl.images?.[0]?.url || "";
        const nome  = pl.name || "Playlist";
        const total = pl.tracks?.total || 0;
        const delay = Math.min(i * 0.05, 0.5);

        const card = $(`
            <div class="playlist-card" style="animation-delay:${delay}s">
                ${img ? `<img src="${img}" alt="${nome}" class="playlist-card-cover">` : `<div class="playlist-card-cover"></div>`}
                <div class="playlist-card-name">${nome}</div>
                <div class="playlist-card-meta">${total} músicas</div>
            </div>
        `);

        card.on("click", () => {
            window.location.href = "index.html";
        });

        grid.append(card);
    });
}

// ─────────────────────────────────────────
//  CARREGAR ARTISTAS SEGUIDOS
// ─────────────────────────────────────────
async function carregarArtistas() {
    const data = await spotifyGet("/me/following?type=artist&limit=20");
    const artistas = data?.artists?.items?.filter(Boolean) || [];
    if (artistas.length === 0) return;

    $("#artistas-section").show();
    const grid = $("#profile-artists");

    artistas.forEach((ar, i) => {
        const img   = ar.images?.[1]?.url || ar.images?.[0]?.url || "";
        const nome  = ar.name || "";
        const delay = Math.min(i * 0.05, 0.5);

        const card = $(`
            <div class="artist-card" style="animation-delay:${delay}s">
                ${img ? `<img src="${img}" alt="${nome}" class="artist-card-photo">` : `<div class="artist-card-photo"></div>`}
                <div class="artist-card-name">${nome}</div>
            </div>
        `);

        grid.append(card);
    });
}

// ─────────────────────────────────────────
//  INICIALIZAÇÃO
// ─────────────────────────────────────────
$(document).ready(async function () {
    // Redireciona para login se não estiver autenticado
    if (!localStorage.getItem("se_usuario") && !localStorage.getItem("se_spotify_user")) {
        window.location.href = "login.html";
        return;
    }

    await carregarPerfil();
    await carregarPlaylists();
    await carregarArtistas();
});
