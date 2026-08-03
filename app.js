/**
 * OBSIDIAN SMP — Official Store · app.js
 * Full application logic: particles, login, cart, shulker viewer, checkout
 */

// ─── CONFIGURATION ───────────────────────────────────────────
// REEMPLAZA ESTO CON EL LINK DE TU TIENDA TEBEX (EJEMPLO: https://obsidian-smp.tebex.io)
const TEBEX_STORE_URL = "https://tu-tienda.tebex.io";

// CONFIGURACIÓN DE SUPABASE (TIEMPO REAL)
// Regístrate gratis en supabase.com, crea un proyecto y pega tus credenciales aquí.
const SUPABASE_URL = "https://ijfvbgglhvhzbmmqrnwc.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_2w2khQIaLpbQNB-sQyt_pg_Dzufp7z0";

let supabaseClient = null;
if (typeof window.supabase !== 'undefined' && SUPABASE_URL !== "TU_SUPABASE_URL" && SUPABASE_ANON_KEY !== "TU_SUPABASE_ANON_KEY") {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

// ─── SUPABASE / DATABASE WRAPPERS ─────────────────────────────
async function dbFetchListings() {
    if (!supabaseClient) return;
    try {
        const { data, error } = await supabaseClient
            .from('listings')
            .select('*')
            .order('created_at', { ascending: false });
        if (error) throw error;
        if (data) {
            state.marketplaceListings = data.map(item => ({
                id: item.id,
                title: item.title,
                category: item.category,
                price: item.price,
                desc: item.desc_text,
                image: item.image,
                publisher: item.publisher,
                timeAgo: calculateTimeAgo(item.created_at)
            }));
            localStorage.setItem('obs_market_listings', JSON.stringify(state.marketplaceListings));
        }
    } catch (err) {
        console.error("Error cargando listings de Supabase:", err);
    }
}

async function dbFetchConversations() {
    if (!supabaseClient || !state.username) return;
    try {
        const { data, error } = await supabaseClient
            .from('conversations')
            .select('*');
        if (error) throw error;
        if (data) {
            state.conversations = data
                .filter(c => {
                    const sellerName = c.seller && c.seller.includes('|') ? c.seller.split('|')[0] : c.seller;
                    const buyerName = c.buyer && c.buyer.includes('|') ? c.buyer.split('|')[0] : c.buyer;
                    return sellerName.toLowerCase() === state.username.toLowerCase() || 
                           buyerName.toLowerCase() === state.username.toLowerCase();
                })
                .map(c => ({
                    id: c.id,
                    listingId: c.listing_id,
                    buyer: c.buyer,
                    seller: c.seller,
                    status: c.status,
                    messages: c.messages
                }));
            localStorage.setItem('obs_conversations', JSON.stringify(state.conversations));
        }
    } catch (err) {
        console.error("Error cargando chats de Supabase:", err);
    }
}

function calculateTimeAgo(timestamp) {
    const diff = Date.now() - new Date(timestamp).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'Hace un momento';
    if (minutes < 60) return `Hace ${minutes} min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `Hace ${hours} ${hours === 1 ? 'hora' : 'horas'}`;
    const days = Math.floor(hours / 24);
    return `Hace ${days} ${days === 1 ? 'día' : 'días'}`;
}

// Suscripción Realtime
if (supabaseClient) {
    supabaseClient
        .channel('schema-db-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'listings' }, () => {
            dbFetchListings().then(() => renderMarketplace());
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, () => {
            dbFetchConversations().then(() => {
                renderInboxList();
                renderChatMessages();
                updateInboxBadge();
            });
        })
        .subscribe();
}

// CONFIGURACIÓN DE DISCORD CLIENT
const DISCORD_CLIENT_ID = localStorage.getItem('obs_discord_client_id') || "1532950008251551844"; // Reemplazar con el Client ID de tu aplicación de Discord

// ─── STATE ───────────────────────────────────────────────────
const state = {
    username: '',
    isBedrock: localStorage.getItem('obs_bedrock') === 'true',
    points: 0,
    discordUser: null,
    discordId: null,
    discordTag: null,
    cart: [],
    payMethod: 'visa',
    currentKit: null,
    activeMarketCategory: 'all',
    marketSearchQuery: '',
    uploadedImageBase64: null,
    marketplaceListings: JSON.parse(localStorage.getItem('obs_market_listings') || '[]'),
    conversations: JSON.parse(localStorage.getItem('obs_conversations') || '[]'),
    // Profile customization
    unlockedFrames: JSON.parse(localStorage.getItem('obs_unlocked_frames') || '[]'),
    activeFrame: localStorage.getItem('obs_active_frame') || '',
    avatarSource: localStorage.getItem('obs_avatar_source') || 'discord',
    customAvatar: localStorage.getItem('obs_custom_avatar') || '',
    profileFont: localStorage.getItem('obs_profile_font') || 'Outfit',
    redeemedCodes: JSON.parse(localStorage.getItem('obs_redeemed_codes') || '[]')
};

function parsePublisher(pubStr) {
    if (!pubStr) return { username: 'Invitado', discordId: null, avatar: null };
    if (pubStr.includes('|')) {
        const parts = pubStr.split('|');
        return { username: parts[0], discordId: parts[1] || null, avatar: parts[2] || null };
    }
    return { username: pubStr, discordId: null, avatar: null };
}

function isAdminUser() {
    const isDiscordAdmin = state.discordTag && state.discordTag.toLowerCase() === 'pablitorey_';
    const isMcAdmin = state.username && state.username.toLowerCase() === 'elpayasowtf123';
    return !!(isDiscordAdmin || isMcAdmin);
}

function getPublisherAvatar(pubInfo, size = 32) {
    if (pubInfo.discordId) {
        if (pubInfo.avatar) {
            return `https://cdn.discordapp.com/avatars/${pubInfo.discordId}/${pubInfo.avatar}.png`;
        }
        return `https://cdn.discordapp.com/embed/avatars/0.png`;
    }
    return `https://mc-heads.net/avatar/${encodeURIComponent(pubInfo.username || 'Steve')}/${size}`;
}

// ─── DISCORD AUTHENTICATION FUNCTIONS ──────────────────────────
function checkDiscordCallback() {
    if (window.location.hash) {
        const params = new URLSearchParams(window.location.hash.substring(1));
        const token = params.get("access_token");
        if (token) {
            localStorage.setItem("obs_discord_token", token);
            window.history.replaceState({}, document.title, window.location.pathname);
            showToast("🌐 Conectando con Discord...");
        }
    }
}
async function verifyDiscordLogin() {
    const token = localStorage.getItem("obs_discord_token");
    const authView = document.getElementById('discord-auth-view');
    const linkView = document.getElementById('minecraft-link-view');
    const passLoginView = document.getElementById('mc-password-login-view');
    
    // Si inició sesión con contraseña local (sin Discord)
    const localUser = localStorage.getItem('obs_logged_without_discord_user');
    const localId = localStorage.getItem('obs_logged_without_discord_id');
    
    if (localUser && localId && !token) {
        state.username = localUser;
        state.discordId = localId;
        state.discordTag = 'Acceso sin Discord';
        loadUserDataOnLogin(localId, localUser);
        return true;
    }
    
    if (passLoginView) passLoginView.style.display = 'none';
    
    if (!token) {
        if (authView) authView.style.display = 'block';
        if (linkView) linkView.style.display = 'none';
        return false;
    }
    
    try {
        const res = await fetch("https://discord.com/api/users/@me", {
            headers: { "Authorization": `Bearer ${token}` }
        });
        if (res.ok) {
            const user = await res.json();
            state.discordUser = user;
            state.discordId = user.id;
            state.discordTag = `${user.username}#${user.discriminator || '0'}`;
            
            // Cargar usuario de Minecraft enlazado
            state.username = localStorage.getItem(`obs_mc_user_${user.id}`) || '';
            
            // Si no está en local storage (ej: otro dispositivo), lo buscamos en la base de datos
            if (!state.username && supabaseClient) {
                try {
                    const { data } = await supabaseClient
                        .from('conversations')
                        .select('*')
                        .eq('listing_id', 'registration')
                        .eq('seller', user.id);
                    if (data && data.length > 0) {
                        state.username = data[0].buyer;
                        localStorage.setItem(`obs_mc_user_${user.id}`, state.username);
                        localStorage.setItem('obs_user', state.username);
                    }
                } catch(err) {
                    console.error("Error fetching user from Supabase:", err);
                }
            }
            
            loadUserDataOnLogin(user.id, state.username);

            if (state.username) {
                closeModal('modal-login');
            } else {
                if (authView) authView.style.display = 'none';
                if (linkView) linkView.style.display = 'block';
                openModal('modal-login');
            }
            return true;
        } else {
            localStorage.removeItem("obs_discord_token");
            if (authView) authView.style.display = 'block';
            if (linkView) linkView.style.display = 'none';
            return false;
        }
    } catch (e) {
        console.error("Error verifying Discord token:", e);
        if (authView) authView.style.display = 'block';
        if (linkView) linkView.style.display = 'none';
        return false;
    }
}

function loginWithDiscord() {
    let redirectUri = window.location.origin + window.location.pathname;
    if (redirectUri.endsWith('/') && window.location.pathname === '/') {
        redirectUri = redirectUri.slice(0, -1);
    }
    const url = `https://discord.com/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=token&scope=identify`;
    window.location.href = url;
}

function logout() {
    // Clear user tokens & account session
    localStorage.removeItem("obs_discord_token");
    localStorage.removeItem("obs_logged_without_discord_user");
    localStorage.removeItem("obs_logged_without_discord_id");
    
    // Clear user customization state & storage
    localStorage.removeItem("obs_active_frame");
    localStorage.removeItem("obs_unlocked_frames");
    localStorage.removeItem("obs_custom_avatar");
    localStorage.removeItem("obs_avatar_source");
    localStorage.removeItem("obs_redeemed_codes");

    state.username = '';
    state.discordUser = null;
    state.discordId = null;
    state.discordTag = null;
    state.points = 0;
    state.activeFrame = '';
    state.unlockedFrames = [];
    state.customAvatar = '';
    state.avatarSource = 'discord';
    
    syncUser();
    renderMarketListings();
    
    showToast("🚪 Sesión cerrada correctamente.");
    
    const authView = document.getElementById('discord-auth-view');
    const linkView = document.getElementById('minecraft-link-view');
    const passLoginView = document.getElementById('mc-password-login-view');
    const profileView = document.getElementById('profile-settings-view');
    if (authView) authView.style.display = 'block';
    if (linkView) linkView.style.display = 'none';
    if (passLoginView) passLoginView.style.display = 'none';
    if (profileView) profileView.style.display = 'none';
    
    closeModal('modal-user-profile');
    openModal('modal-login');
}

async function unlinkAccount() {
    if (!state.discordId || !state.username) return;
    
    closeModal('modal-login');
    closeModal('modal-user-profile');
    
    customConfirm(
        '¿Desvincular cuenta?',
        '¿Estás seguro de que quieres desvincular tu usuario de Minecraft de tu cuenta de Discord? Esto liberará tu Nickname en el servidor.',
        async () => {
            if (supabaseClient) {
                showToast("⏳ Desvinculando cuenta de la base de datos...");
                try {
                    const { error } = await supabaseClient
                        .from('conversations')
                        .delete()
                        .eq('listing_id', 'registration')
                        .eq('buyer', state.username.toLowerCase())
                        .eq('seller', state.discordId);
                    if (error) throw error;
                } catch (err) {
                    console.error("Error al desvincular cuenta:", err);
                    showToast("❌ Error al desvincular de la base de datos, pero se cerrará sesión local.");
                }
            }

            localStorage.removeItem(`obs_mc_user_${state.discordId}`);
            logout();
            showToast("✅ Cuenta desvinculada y sesión cerrada.");
        }
    );
}

function toggleSetting(key) {
    if (key === 'sound') {
        const current = localStorage.getItem('mc_sound') !== 'false';
        localStorage.setItem('mc_sound', !current ? 'true' : 'false');
        updateSettingsUI();
        if (!current) playMcClick();
    } else if (key === 'particles') {
        const current = localStorage.getItem('mc_particles') !== 'false';
        localStorage.setItem('mc_particles', !current ? 'true' : 'false');
        updateSettingsUI();
        const canvas = document.getElementById('particles-canvas');
        if (canvas) {
            canvas.style.display = !current ? 'block' : 'none';
        }
    }
}

function toggle2FA() {
    const cb = document.getElementById('enable-2fa-checkbox');
    const pc = document.getElementById('password-container');
    if (cb && pc) {
        pc.style.display = cb.checked ? 'block' : 'none';
    }
}

function updateSettingsUI() {
    const soundButtons = document.querySelectorAll('#setting-sound-btn');
    const particlesButtons = document.querySelectorAll('#setting-particles-btn');
    
    const soundOn = localStorage.getItem('mc_sound') !== 'false';
    const particlesOn = localStorage.getItem('mc_particles') !== 'false';
    
    soundButtons.forEach(btn => {
        btn.textContent = soundOn ? 'Sí' : 'No';
        btn.classList.toggle('yes', soundOn);
    });
    
    particlesButtons.forEach(btn => {
        btn.textContent = particlesOn ? 'Sí' : 'No';
        btn.classList.toggle('yes', particlesOn);
    });
}

function playMcClick() {
    if (localStorage.getItem('mc_sound') === 'false') return;
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(120, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(10, ctx.currentTime + 0.05);
        
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.05);
        
        osc.start();
        osc.stop(ctx.currentTime + 0.05);
    } catch (e) {}
}

function playVictoryFanfare() {
    if (localStorage.getItem('mc_sound') === 'false') return;
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const notes = [523.25, 659.25, 783.99, 1046.50, 1318.51];
        notes.forEach((freq, idx) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            
            osc.type = 'sine';
            const startTime = ctx.currentTime + idx * 0.08;
            osc.frequency.setValueAtTime(freq, startTime);
            
            gain.gain.setValueAtTime(0.2, startTime);
            gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.35);
            
            osc.start(startTime);
            osc.stop(startTime + 0.35);
        });
    } catch (e) {}
}

function triggerConfetti(targetContainer = document.body) {
    const confettiColors = ['#f59e0b', '#a855f7', '#10b981', '#06b6d4', '#ec4899', '#fde047'];
    const container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.inset = '0';
    container.style.pointerEvents = 'none';
    container.style.zIndex = '999999';
    container.style.overflow = 'hidden';
    targetContainer.appendChild(container);

    const particleCount = 75;
    const originX = window.innerWidth / 2;
    const originY = window.innerHeight / 2;

    for (let i = 0; i < particleCount; i++) {
        const p = document.createElement('div');
        const color = confettiColors[Math.floor(Math.random() * confettiColors.length)];
        const size = Math.random() * 8 + 6;
        const angle = Math.random() * Math.PI * 2;
        const velocity = Math.random() * 12 + 6;
        const vx = Math.cos(angle) * velocity;
        const vy = Math.sin(angle) * velocity - 4;

        p.style.position = 'absolute';
        p.style.left = `${originX}px`;
        p.style.top = `${originY}px`;
        p.style.width = `${size}px`;
        p.style.height = `${size * (Math.random() > 0.5 ? 1 : 2)}px`;
        p.style.background = color;
        p.style.borderRadius = Math.random() > 0.5 ? '50%' : '3px';
        p.style.boxShadow = `0 0 8px ${color}`;
        p.style.transform = `rotate(${Math.random() * 360}deg)`;
        container.appendChild(p);

        let posX = originX;
        let posY = originY;
        let curVx = vx;
        let curVy = vy;
        let opacity = 1;

        const anim = setInterval(() => {
            posX += curVx;
            posY += curVy;
            curVy += 0.4;
            curVx *= 0.98;
            opacity -= 0.018;

            p.style.left = `${posX}px`;
            p.style.top = `${posY}px`;
            p.style.opacity = opacity;

            if (opacity <= 0 || posY > window.innerHeight) {
                clearInterval(anim);
                p.remove();
            }
        }, 16);
    }

    setTimeout(() => container.remove(), 2500);
}

function customConfirm(title, msg, onOk) {
    const titleEl = document.getElementById('confirm-modal-title');
    const msgEl = document.getElementById('confirm-modal-msg');
    const okBtn = document.getElementById('confirm-modal-ok-btn');
    const cancelBtn = document.getElementById('confirm-modal-cancel-btn');
    
    if (titleEl) titleEl.textContent = title;
    if (msgEl) msgEl.textContent = msg;
    
    const newOk = okBtn.cloneNode(true);
    okBtn.parentNode.replaceChild(newOk, okBtn);
    const newCancel = cancelBtn.cloneNode(true);
    cancelBtn.parentNode.replaceChild(newCancel, cancelBtn);
    
    newCancel.addEventListener('click', () => {
        closeModal('modal-confirm');
    });
    
    newOk.addEventListener('click', () => {
        closeModal('modal-confirm');
        if (onOk) onOk();
    });
    
    openModal('modal-confirm');
}

if (!state.marketplaceListings) {
    state.marketplaceListings = [];
}
state.marketplaceListings = state.marketplaceListings.filter(item => !/^[m][1-6]$/.test(item.id));
localStorage.setItem('obs_market_listings', JSON.stringify(state.marketplaceListings));

function loadInitialDatabaseData() {
    if (supabaseClient) {
        dbFetchListings().then(() => {
            if (state.activeMarketCategory) renderMarketplace();
            renderFactions();
        });
        dbFetchConversations().then(() => {
            updateInboxBadge();
        });
    } else {
        setTimeout(() => {
            if (state.activeMarketCategory) renderMarketplace();
            renderFactions();
            updateInboxBadge();
        }, 100);
    }
}

// ─── KIT DATA ─────────────────────────────────────────────────
const KITS = {
    amber: {
        label: 'Rango Amber + Shulker Roja',
        price: 2.00,
        tier: 'AMBER',
        colorClass: 'amber-color',
        image: 'img/amber.jpeg',
        highlights: [
            'Armadura: Full Diamante Completo',
            'Herramientas: Espada, Pico y Hacha de Diamante',
            'Comida: 64x Carne Cocinada (1 Stack)',
            'Libros Encantados: 4x Protección III & 7x Irrompible III',
            'Libros Especiales: 1x Fortuna III, 1x Filo V y 1x Reparación'
        ]
    },
    void: {
        label: 'Rango Void + Shulker Morada',
        price: 4.00,
        tier: 'VOID',
        colorClass: 'void-color',
        image: 'img/void.jpeg',
        highlights: [
            'Armadura: Full Netherite (Protección IV, Irrompible III, Reparación)',
            'Pico Netherite: Fortuna III, Irrompible III, Eficiencia V, Reparación',
            'Hacha Netherite: Irrompible III, Eficiencia V, Reparación',
            'Espada Netherite: Filo V, Irrompible III, Reparación',
            'Tridente (Lealtad III, Irrompible III, Reparación) + Arco (Llama) + Escudo',
            '1x Tótem de Inmortalidad, 16x Perlas, 32x Manzanas de Oro, 64x Zanahorias Doradas y 64x Flechas'
        ]
    },
    midnight: {
        label: 'Rango Midnight + Shulker Negra',
        price: 6.00,
        tier: 'MIDNIGHT',
        colorClass: 'midnight-color',
        image: 'img/midnight.png',
        highlights: [
            'Armadura: Full Netherite (Protección IV, Irrompible III, Reparación)',
            'Pico Netherite: Fortuna III, Irrompible III, Eficiencia V, Reparación',
            'Hacha Netherite: Irrompible III, Eficiencia V, Reparación',
            'Espada Netherite: Filo V, Aspecto Ígneo II, Irrompible III, Reparación',
            'Equipamiento Supremo: Elytras + Mazo de Combate + Arco (Infinidad) + Escudo',
            'Diseño de Armadura de Warden (Plantilla Especial)',
            '3x Tótems de Inmortalidad, 16x Perlas, 64x Cohetes de Vuelo (Nivel 3) y 64x Cargas de Viento'
        ]
    },
    ascension: {
        label: 'Rango Ascension + Shulker Dorada',
        price: 8.00,
        tier: 'ASCENSION',
        colorClass: 'ascension-color',
        image: null,
        comingSoon: true
    },
    celestial: {
        label: 'Rango Celestial + Shulker Cósmica',
        price: 10.00,
        tier: 'CELESTIAL',
        colorClass: 'celestial-color',
        image: null,
        comingSoon: true
    }
};

// ─── MINECRAFT ENCHANTMENT PARTICLES ──────────────────────────
function initParticles() {
    const canvas = document.getElementById('particles-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let W = canvas.width = window.innerWidth;
    let H = canvas.height = window.innerHeight;

    const COLORS = [
        'rgba(168, 85, 247, ', // Obsidian Neon Purple
        'rgba(192, 132, 252, ', // Glowing Lilac
        'rgba(52, 211, 153, ',  // Emerald Green
        'rgba(250, 204, 21, '   // Enchantment Gold
    ];

    const particles = Array.from({ length: 65 }, () => ({
        x: Math.random() * W,
        y: Math.random() * H,
        size: Math.random() * 4 + 2, // Blocky square particles
        vy: - (Math.random() * 0.4 + 0.1), // Slow float up
        vx: (Math.random() - 0.5) * 0.25,
        alpha: Math.random() * 0.7 + 0.2,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        rotation: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 0.02
    }));

    function draw() {
        ctx.clearRect(0, 0, W, H);
        particles.forEach(p => {
            p.y += p.vy;
            p.x += p.vx;
            p.rotation += p.rotSpeed;

            if (p.y < -10) { p.y = H + 10; p.x = Math.random() * W; }
            if (p.x < -10) p.x = W + 10;
            if (p.x > W + 10) p.x = -10;

            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rotation);
            ctx.fillStyle = `${p.color}${p.alpha})`;
            ctx.shadowColor = `${p.color}0.8)`;
            ctx.shadowBlur = 8;
            ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
            ctx.restore();
        });
        requestAnimationFrame(draw);
    }
    draw();

    let lastWidth = window.innerWidth;
    window.addEventListener('resize', () => {
        if (window.innerWidth !== lastWidth) {
            W = canvas.width = window.innerWidth;
            H = canvas.height = window.innerHeight;
            lastWidth = window.innerWidth;
        }
    });
}

// ─── INIT ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    initParticles();
    checkDiscordCallback();
    
    // Configuración inicial de partículas
    const canvas = document.getElementById('particles-canvas');
    if (canvas) {
        const particlesOn = localStorage.getItem('mc_particles') !== 'false';
        canvas.style.display = particlesOn ? 'block' : 'none';
    }
    
    const isLogged = await verifyDiscordLogin();
    loadInitialDatabaseData();
    
    if (!isLogged) {
        setTimeout(() => openModal('modal-login'), 700);
    }
    
    renderCart();
    bindEvents();
    
    // (Actualización de estado del servidor en tiempo real deshabilitada)

    // Interceptor global para reproducir sonido de clic al interactuar
    document.addEventListener('click', (e) => {
        const target = e.target.closest('button, a, .market-card, .cat-tab, .points-pill, .user-pill, .modal-close');
        if (target) {
            playMcClick();
        }
    });

    window.addEventListener('scroll', () => {
        document.getElementById('navbar')?.classList.toggle('scrolled', window.scrollY > 10);
    });
});

// ─── MULTI-VIEW NAVIGATION ────────────────────────────────────
function switchTab(tabId) {
    const validTabs = ['inicio', 'reglas', 'quienes', 'kits', 'puntos', 'marketplace', 'facciones'];
    if (!validTabs.includes(tabId)) tabId = 'inicio';

    document.querySelectorAll('.view-section').forEach(sec => {
        sec.style.display = 'none';
        sec.classList.remove('active');
    });

    const target = document.getElementById(`view-${tabId}`);
    if (target) {
        target.style.display = 'block';
        setTimeout(() => target.classList.add('active'), 10);
    }

    document.querySelectorAll('.cat-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.tab === tabId);
    });

    syncUser();

    if (tabId === 'marketplace') {
        renderMarketplace();
    }
    if (tabId === 'facciones') {
        renderFactions();
    }

    const navBar = document.getElementById('main-nav-bar');
    if (navBar && tabId !== 'inicio') {
        const topPos = navBar.getBoundingClientRect().top + window.pageYOffset - 80;
        window.scrollTo({ top: Math.max(0, topPos), behavior: 'smooth' });
    } else {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

// ─── USER & POINTS ─────────────────────────────────────────────
function loadUserDataOnLogin(userId, username) {
    const key = userId || (username ? username.toLowerCase() : 'guest');
    
    // Points
    const p1 = parseInt(localStorage.getItem('obs_points') || '0', 10);
    const p2 = parseInt(localStorage.getItem(`obs_points_${key}`) || '0', 10);
    const p3 = username ? parseInt(localStorage.getItem(`obs_points_${username.toLowerCase()}`) || '0', 10) : 0;
    state.points = Math.max(p1, p2, p3);

    // Active Frame
    state.activeFrame = localStorage.getItem(`obs_active_frame_${key}`) ||
                        (username ? localStorage.getItem(`obs_active_frame_${username.toLowerCase()}`) : null) ||
                        localStorage.getItem('obs_active_frame') || '';

    // Unlocked Frames
    const rawUnlocked = localStorage.getItem(`obs_unlocked_frames_${key}`) ||
                        (username ? localStorage.getItem(`obs_unlocked_frames_${username.toLowerCase()}`) : null) ||
                        localStorage.getItem('obs_unlocked_frames') || '[]';
    try {
        state.unlockedFrames = JSON.parse(rawUnlocked);
    } catch(e) {
        state.unlockedFrames = [];
    }

    // Last Spin Time
    const spinTime = localStorage.getItem(`obs_last_spin_time_${key}`) ||
                     (username ? localStorage.getItem(`obs_last_spin_time_${username.toLowerCase()}`) : null) ||
                     localStorage.getItem('obs_last_spin_time') || '0';
    localStorage.setItem('obs_last_spin_time', spinTime);

    // Supabase DB Sync
    if (supabaseClient && username && username !== 'Invitado') {
        supabaseClient
            .from('user_profiles')
            .select('*')
            .eq('username', username)
            .then(({ data }) => {
                if (data && data.length > 0) {
                    const prof = data[0];
                    if (prof.points !== undefined && prof.points > state.points) {
                        state.points = prof.points;
                    }
                    if (prof.active_frame) {
                        state.activeFrame = prof.active_frame;
                    }
                    if (prof.unlocked_frames) {
                        try {
                            const dbFrames = typeof prof.unlocked_frames === 'string' ? JSON.parse(prof.unlocked_frames) : prof.unlocked_frames;
                            if (Array.isArray(dbFrames)) {
                                state.unlockedFrames = Array.from(new Set([...state.unlockedFrames, ...dbFrames]));
                            }
                        } catch(e) {}
                    }
                    if (prof.last_spin_time) {
                        localStorage.setItem('obs_last_spin_time', prof.last_spin_time.toString());
                        localStorage.setItem(`obs_last_spin_time_${key}`, prof.last_spin_time.toString());
                    }
                    saveUserDataToStorage();
                    syncUser();
                }
            })
            .catch(() => {});
    }

    saveUserDataToStorage();
    syncUser();
}

function saveUserDataToStorage() {
    const key = state.discordId || (state.username ? state.username.toLowerCase() : null);

    localStorage.setItem('obs_points', state.points);
    localStorage.setItem('obs_active_frame', state.activeFrame || '');
    localStorage.setItem('obs_unlocked_frames', JSON.stringify(state.unlockedFrames || []));

    if (key) {
        localStorage.setItem(`obs_points_${key}`, state.points);
        localStorage.setItem(`obs_active_frame_${key}`, state.activeFrame || '');
        localStorage.setItem(`obs_unlocked_frames_${key}`, JSON.stringify(state.unlockedFrames || []));
        const lastSpin = localStorage.getItem('obs_last_spin_time') || '0';
        localStorage.setItem(`obs_last_spin_time_${key}`, lastSpin);
    }

    if (state.username && state.username !== 'Invitado') {
        const uKey = state.username.toLowerCase();
        localStorage.setItem(`obs_points_${uKey}`, state.points);
        localStorage.setItem(`obs_active_frame_${uKey}`, state.activeFrame || '');
        localStorage.setItem(`obs_unlocked_frames_${uKey}`, JSON.stringify(state.unlockedFrames || []));
    }

    // Save to Supabase
    if (supabaseClient && state.username && state.username !== 'Invitado') {
        const lastSpin = localStorage.getItem('obs_last_spin_time') || '0';
        try {
            supabaseClient
                .from('user_profiles')
                .upsert({
                    username: state.username,
                    points: state.points,
                    active_frame: state.activeFrame || '',
                    unlocked_frames: JSON.stringify(state.unlockedFrames || []),
                    last_spin_time: lastSpin
                }, { onConflict: 'username' })
                .then(() => {})
                .catch(() => {});
        } catch(e) {}
    }
}

function onUserPillClick() {
    if (state.username && state.username !== 'Invitado') {
        openUserProfileModal(state.username);
    } else {
        openModal('modal-login');
    }
}

function updateNavUserAvatar() {
    const wrap = document.getElementById('nav-avatar-wrap');
    if (!wrap) return;

    const isGuest = !state.username || state.username === 'Invitado';
    if (isGuest) {
        wrap.innerHTML = `
            <img id="nav-skin-img" src="https://mc-heads.net/avatar/MHF_Steve/30" alt="Skin" class="user-avatar-small" style="width: 28px; height: 28px; border-radius: 50%; border: 1.5px solid rgba(168,85,247,0.3); image-rendering: pixelated; display: block; object-fit: cover;">
        `;
        return;
    }

    let avatarSrc;
    if (state.avatarSource === 'custom' && state.customAvatar) {
        avatarSrc = state.customAvatar;
    } else if (state.avatarSource === 'discord' && state.discordId) {
        avatarSrc = state.discordUser?.avatar
            ? `https://cdn.discordapp.com/avatars/${state.discordId}/${state.discordUser.avatar}.png`
            : `https://cdn.discordapp.com/embed/avatars/0.png`;
    } else {
        avatarSrc = `https://mc-heads.net/avatar/${encodeURIComponent(state.username || 'Steve')}/40`;
    }

    const frameId = state.activeFrame || '';
    wrap.innerHTML = getAvatarFrameHTML(avatarSrc, frameId, {
        size: '30px',
        alt: state.username || 'Usuario'
    });
}

function syncUser() {
    const u = state.username || 'Invitado';
    const navName = document.getElementById('nav-username');
    const ownerSkin = document.getElementById('owner-skin-img');
    if (navName) navName.textContent = u;

    updateNavUserAvatar();

    if (ownerSkin) ownerSkin.src = `https://mc-heads.net/avatar/MHF_Steve/80`;

    const coName = document.getElementById('checkout-username');
    if (coName) coName.textContent = u;

    // Points sync
    const navPts = document.getElementById('nav-points-val');
    const heroPts = document.getElementById('hero-pts-count');
    const pagePts = document.getElementById('page-points-val');
    const modalPts = document.getElementById('points-modal-balance');
    if (navPts) navPts.textContent = state.points;
    if (heroPts) heroPts.textContent = state.points;
    if (pagePts) pagePts.textContent = state.points;
    // Cart status color
    const total = cartTotal();
    const qty = cartQty();
    const navStatus = document.getElementById('nav-cart-status') || document.querySelector('.cart-status');
    if (navStatus) {
        if (qty === 0) {
            navStatus.textContent = 'HAZ CLIC PARA INICIAR';
            navStatus.style.color = '#f87171';
        } else {
            navStatus.textContent = `${qty} ÍTEM${qty > 1 ? 'S' : ''} · $${total.toFixed(2)}`;
            navStatus.style.color = '#4ade80';
        }
    }

    const bt = document.getElementById('bedrock-btn');
    if (bt) { bt.textContent = state.isBedrock ? 'Sí' : 'No'; bt.classList.toggle('yes', state.isBedrock); }

    const ls = document.getElementById('login-skin-img');
    if (ls) ls.src = `https://mc-heads.net/head/${encodeURIComponent(u)}`;
}

function bindEvents() {
    document.getElementById('brand-logo-btn')?.addEventListener('click', () => {
        switchTab('inicio');
    });

    document.getElementById('save-user-btn')?.addEventListener('click', saveUser);
    document.getElementById('username-input')?.addEventListener('keypress', e => { if (e.key === 'Enter') saveUser(); });
    document.getElementById('password-input')?.addEventListener('keypress', e => { if (e.key === 'Enter') saveUser(); });

    let debounce;
    let descDebounce;
    document.getElementById('username-input')?.addEventListener('input', e => {
        clearTimeout(debounce);
        clearTimeout(descDebounce);
        
        const v = e.target.value.trim();
        if (v) {
            debounce = setTimeout(() => {
                document.getElementById('login-skin-img').src = `https://mc-heads.net/head/${encodeURIComponent(v)}`;
            }, 400);

            descDebounce = setTimeout(async () => {
                if (supabaseClient) {
                    try {
                        const { data } = await supabaseClient
                            .from('conversations')
                            .select('*')
                            .eq('listing_id', 'registration')
                            .eq('buyer', v.toLowerCase());
                        
                        const desc = document.getElementById('mc-link-desc');
                        if (desc) {
                            if (data && data.length > 0) {
                                const reg = data[0];
                                const storedPass = reg.messages && reg.messages[0] ? reg.messages[0].replace('pass:', '') : '';
                                if (storedPass === 'none') {
                                    desc.innerHTML = '❌ Este usuario ya está registrado a otro Discord sin contraseña de recuperación.';
                                } else {
                                    desc.innerHTML = '⚠️ Este usuario de Minecraft ya está registrado. <strong style="color: var(--primary);">Activa y escribe su contraseña de recuperación</strong> para enlazarlo.';
                                }
                            } else {
                                desc.innerHTML = '✨ El usuario está disponible. <strong style="color: #4ade80;">Te sugerimos activar la contraseña</strong> para proteger tu cuenta.';
                            }
                        }
                    } catch(err){}
                }
            }, 500);
        }
    });

    document.getElementById('copy-ip-btn')?.addEventListener('click', copyIP);

    document.getElementById('card-num')?.addEventListener('input', e => {
        let v = e.target.value.replace(/\D/g,'').substring(0,16);
        e.target.value = v.replace(/(.{4})/g,'$1 ').trim();
    });

    document.getElementById('card-exp')?.addEventListener('input', e => {
        let v = e.target.value.replace(/\D/g,'');
        if (v.length >= 2) v = v.substring(0,2) + '/' + v.substring(2,4);
        e.target.value = v;
    });
}

async function saveUser() {
    const inp = document.getElementById('username-input');
    const passInp = document.getElementById('password-input');
    const cb2fa = document.getElementById('enable-2fa-checkbox');
    const v = inp?.value.trim();
    const enteredPass = passInp?.value.trim();
    const is2FAEnabled = cb2fa ? cb2fa.checked : false;
    
    if (!v) { showToast('⚠️ Ingresa tu usuario de Minecraft.'); return; }
    if (v.includes(' ') || v.includes('|')) { showToast('⚠️ Nombre de usuario no válido.'); return; }
    if (is2FAEnabled && !enteredPass) { showToast('⚠️ Ingresa tu contraseña de seguridad de 2 pasos.'); return; }
    
    if (!state.discordId) {
        showToast('⚠️ Primero debes iniciar sesión con Discord.');
        return;
    }

    const btn = document.getElementById('save-user-btn');
    const origText = btn ? btn.innerHTML : 'ENLAZAR CUENTA';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> VERIFICANDO...';
    }

    // Verificar bloqueo de registro y contraseña en base de datos Supabase
    if (supabaseClient) {
        try {
            const { data, error } = await supabaseClient
                .from('conversations')
                .select('*')
                .eq('listing_id', 'registration')
                .eq('buyer', v.toLowerCase());
            
            if (error) throw error;
            
            if (data && data.length > 0) {
                const reg = data[0];
                const storedPass = reg.messages && reg.messages[0] ? reg.messages[0].replace('pass:', '') : '';
                
                if (storedPass !== 'none') {
                    if (enteredPass !== storedPass) {
                        showToast('❌ Contraseña de seguridad de 2 pasos incorrecta o no activada.');
                        if (btn) {
                            btn.disabled = false;
                            btn.innerHTML = origText;
                        }
                        return;
                    }
                } else if (reg.seller !== state.discordId) {
                    showToast('❌ Esta cuenta está ligada a otro Discord y no tiene contraseña de recuperación configurada.');
                    if (btn) {
                        btn.disabled = false;
                        btn.innerHTML = origText;
                    }
                    return;
                }
                
                // Si la contraseña coincide pero se loguea desde otro Discord, actualizamos el Discord ID (seller)
                if (reg.seller !== state.discordId) {
                    const { error: updError } = await supabaseClient
                        .from('conversations')
                        .update({ seller: state.discordId })
                        .eq('id', reg.id);
                    if (updError) throw updError;
                }
            } else {
                // Registrar este usuario a este Discord ID con su contraseña
                const finalPass = is2FAEnabled ? enteredPass : 'none';
                const { error: insError } = await supabaseClient
                    .from('conversations')
                    .insert([{
                        id: 'reg_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
                        listing_id: 'registration',
                        buyer: v.toLowerCase(),
                        seller: state.discordId,
                        status: 'active',
                        messages: ["pass:" + finalPass]
                    }]);
                if (insError) throw insError;
            }
        } catch (err) {
            console.error("Error al registrar cuenta en Supabase:", err);
            showToast('❌ Error de conexión al verificar el usuario.');
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = origText;
            }
            return;
        }
    }

    if (btn) {
        btn.disabled = false;
        btn.innerHTML = origText;
    }
    
    state.username = v;
    localStorage.setItem(`obs_mc_user_${state.discordId}`, v);
    localStorage.setItem('obs_user', v); // compatible fallback
    
    loadUserDataOnLogin(state.discordId, v);
    closeModal('modal-login');
    showToast(`✅ Cuenta vinculada: ¡Bienvenido, ${v}!`);
    loadInitialDatabaseData();
}

function toggleBedrock() {
    state.isBedrock = !state.isBedrock;
    localStorage.setItem('obs_bedrock', state.isBedrock);
    syncUser();
}

// ─── MODALS ───────────────────────────────────────────────────
function openModal(id) {
    if (id === 'modal-login') {
        const authView = document.getElementById('discord-auth-view');
        const linkView = document.getElementById('minecraft-link-view');
        const passLoginView = document.getElementById('mc-password-login-view');
        const profileView = document.getElementById('profile-settings-view');
        
        if (passLoginView) passLoginView.style.display = 'none';
        
        if (state.discordId && state.username) {
            if (authView) authView.style.display = 'none';
            if (linkView) linkView.style.display = 'none';
            if (profileView) {
                profileView.style.display = 'block';
                const discordAvatar = document.getElementById('profile-discord-avatar');
                const discordTag = document.getElementById('profile-discord-tag');
                const mcSkin = document.getElementById('profile-minecraft-skin');
                const mcName = document.getElementById('profile-minecraft-name');
                const bedrockBadge = document.getElementById('profile-bedrock-badge');
                const javaBadge = document.getElementById('profile-java-badge');
                
                if (discordAvatar) discordAvatar.src = state.discordUser?.avatar 
                    ? `https://cdn.discordapp.com/avatars/${state.discordId}/${state.discordUser.avatar}.png`
                    : "https://cdn.discordapp.com/embed/avatars/0.png";
                if (discordTag) discordTag.textContent = state.discordTag;
                if (mcSkin) mcSkin.src = `https://mc-heads.net/avatar/${encodeURIComponent(state.username)}/60`;
                if (mcName) mcName.textContent = state.username;
                if (bedrockBadge) bedrockBadge.style.display = state.isBedrock ? 'inline-block' : 'none';
                if (javaBadge) javaBadge.style.display = state.isBedrock ? 'none' : 'inline-block';
                updateSettingsUI();
            }
        } else if (state.discordId) {
            if (authView) authView.style.display = 'none';
            if (linkView) linkView.style.display = 'block';
            if (profileView) profileView.style.display = 'none';
        } else {
            if (authView) authView.style.display = 'block';
            if (linkView) linkView.style.display = 'none';
            if (profileView) profileView.style.display = 'none';
        }
    }
    if (id === 'modal-create-listing' || id === 'modal-checkout') {
        if (!state.discordId || !state.username) {
            showToast('⚠️ Debes iniciar sesión con Discord y enlazar tu cuenta de Minecraft para continuar.');
            openModal('modal-login');
            return;
        }
    }
    document.getElementById(id)?.classList.add('open');
}
function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }

// ─── SHULKER MODAL & UPSELL RECOMMENDATIONS ───────────────────
function openShulkerModal(tier) {
    const kit = KITS[tier];
    if (!kit) return;
    state.currentKit = tier;

    document.getElementById('shulker-modal-title').textContent = kit.label;
    document.getElementById('mc-gui-name').textContent = kit.label;
    const chip = document.getElementById('shulker-tier-chip');
    if (chip) {
        chip.textContent = kit.tier;
        chip.className = `shulker-tier-chip ${kit.colorClass}`;
    }

    const view = document.getElementById('mc-inventory-view');
    if (!view) return;

    if (kit.image) {
        const isLowerTier = tier === 'amber' || tier === 'void';
        const upsellKit = KITS['midnight'];
        
        view.innerHTML = `
            <div class="real-inventory-card">
                <div class="inventory-img-wrapper">
                    <img src="${kit.image}" alt="${kit.label}" class="real-inventory-img" />
                    <div class="inventory-badge-tag"><i class="fa-solid fa-check"></i> Captura Real Minecraft</div>
                </div>
                ${kit.highlights ? `
                <div class="inventory-highlights">
                    <div class="highlight-title"><i class="fa-solid fa-sparkles"></i> Contenido de la Shulker Box:</div>
                    <ul class="highlight-list">
                        ${kit.highlights.map(h => `<li><i class="fa-solid fa-circle-check"></i> ${h}</li>`).join('')}
                    </ul>
                </div>` : ''}

                ${isLowerTier ? `
                <div class="upsell-recommend-box">
                    <div class="upsell-header">
                        <span class="upsell-badge"><i class="fa-solid fa-fire"></i> ¡RECOMENDADO POR JUGADORES!</span>
                    </div>
                    <p class="upsell-text">Por solo unos dólares más, el <strong>${upsellKit.label}</strong> incluye Tótems de la Inmortalidad, Elytra Encantadas, Maza y Netherite Elite.</p>
                    <button class="btn-upsell" onclick="upgradeToKit('midnight')">
                        <i class="fa-solid fa-rocket"></i> Mejorar a Kit Midnight ($${upsellKit.price.toFixed(2)} USD)
                    </button>
                </div>` : ''}
            </div>
        `;
    } else {
        view.innerHTML = `
            <div class="coming-soon-inventory">
                <div class="cs-icon-wrap"><i class="fa-solid fa-lock"></i></div>
                <h4>¡Kit ${kit.tier} en Desarrollo!</h4>
                <p>Este kit supremo estará disponible muy pronto en Obsidian SMP con ítems exclusivos del servidor.</p>
            </div>
        `;
    }

    const buyBtn = document.getElementById('shulker-buy-btn');
    if (buyBtn) {
        if (kit.comingSoon) {
            buyBtn.style.display = 'none';
        } else {
            buyBtn.style.display = 'flex';
            buyBtn.innerHTML = `<i class="fa-solid fa-cart-plus"></i> Comprar ${kit.tier} ($${kit.price.toFixed(2)} USD)`;
            buyBtn.onclick = () => { closeModal('modal-shulker'); addToCart(tier, kit.label, kit.price); };
        }
    }

    openModal('modal-shulker');
}

function upgradeToKit(targetTier) {
    closeModal('modal-shulker');
    const target = KITS[targetTier];
    if (target) {
        addToCart(targetTier, target.label, target.price);
        showToast(`🔥 ¡Has seleccionado el kit recomendado ${target.tier}!`);
    }
}

// ─── CART ─────────────────────────────────────────────────────
function addToCart(id, name, price) {
    if (!state.username) {
        showToast('⚠️ Por favor inicia sesión con tu usuario de Minecraft primero.');
        openModal('modal-login');
        return;
    }
    const existing = state.cart.find(i => i.id === id);
    if (existing) { existing.qty++; } else { state.cart.push({ id, name, price, qty: 1 }); }
    renderCart();
    showToast(`🛒 "${name}" añadido al carrito.`);
    openCheckoutModal();
}

function cartQty() { return state.cart.reduce((s, i) => s + i.qty, 0); }
function cartTotal() { return state.cart.reduce((s, i) => s + i.price * i.qty, 0); }

function removeFromCart(id) {
    const idx = state.cart.findIndex(i => i.id === id);
    if (idx !== -1) {
        const removed = state.cart[idx];
        state.cart.splice(idx, 1);
        renderCart();
        showToast(`🗑️ ${removed.name} eliminado del carrito.`);
        if (state.cart.length === 0) {
            closeModal('modal-checkout');
        }
    }
}

function renderCart() {
    const qty = cartQty();
    const total = cartTotal();
    const fmt = v => `$${v.toFixed(2)} USD`;

    const fcC = document.getElementById('fc-count');
    const fcT = document.getElementById('fc-total');
    if (fcC) fcC.textContent = qty;
    if (fcT) fcT.textContent = fmt(total);

    const oi = document.getElementById('order-items');
    if (oi) {
        oi.innerHTML = state.cart.length === 0
            ? '<div class="empty-cart-msg">Tu carrito está vacío.</div>'
            : state.cart.map(i => `
                <div class="order-item-row">
                    <div class="oi-item-left">
                        <span class="oi-qty">${i.qty}x</span>
                        <span class="oi-name">${i.name}</span>
                    </div>
                    <div class="oi-item-right">
                        <span class="oi-price">${fmt(i.price * i.qty)}</span>
                        <button class="cart-remove-btn" onclick="removeFromCart('${i.id}')" title="Eliminar kit del carrito">
                            ✕
                        </button>
                    </div>
                </div>`).join('');
    }

    ['checkout-subtotal','checkout-grand'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = fmt(total);
    });

    const pa = document.getElementById('pay-amt');
    if (pa) pa.textContent = fmt(total);

    syncUser();
}

// ─── CHECKOUT & 2-STEP SUCCESS ─────────────────────────────────
function openCheckoutModal() {
    if (state.cart.length === 0) { showToast('⚠️ Tu carrito está vacío.'); return; }
    document.getElementById('checkout-username').textContent = state.username || 'Invitado';
    openModal('modal-checkout');
}

function selPayMethod(m) {
    state.payMethod = m;
    document.querySelectorAll('.pay-opt').forEach(o => o.classList.toggle('active', o.dataset.m === m));
    document.querySelectorAll('.pay-form').forEach(f => f.classList.toggle('active', f.id === `pay-form-${m}`));
}

function processPayment() {
    const btn = document.getElementById('pay-btn');
    const orig = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> REDIRIGIENDO A TEBEX...';

    setTimeout(() => {
        btn.disabled = false;
        btn.innerHTML = orig;
        closeModal('modal-checkout');
        
        // Redirigir a la tienda oficial de Tebex para el pago seguro
        window.open(TEBEX_STORE_URL, '_blank');
        
        showToast('🔒 Redirigiendo a nuestra tienda segura en Tebex para completar tu compra.');
    }, 800);
}

function nextSuccessStep() {
    const s1 = document.getElementById('success-step-1');
    const s2 = document.getElementById('success-step-2');
    if (s1) { s1.style.display = 'none'; s1.classList.remove('active'); }
    if (s2) { s2.style.display = 'flex'; s2.classList.add('active'); }
}

function prevSuccessStep() {
    const s1 = document.getElementById('success-step-1');
    const s2 = document.getElementById('success-step-2');
    if (s1) { s1.style.display = 'flex'; s1.classList.add('active'); }
    if (s2) { s2.style.display = 'none'; s2.classList.remove('active'); }
}

function saveUserPoints(newAmount) {
    state.points = Math.max(0, parseInt(newAmount, 10) || 0);
    saveUserDataToStorage();
    syncUser();
}

// ─── OBSIDIAN GEMAS REWARDS ───────────────────────────────────
function redeemReward(rewardId, gemasCost, rewardName) {
    if (state.points < gemasCost) {
        showToast(`⚠️ No tienes suficientes Gemas. Necesitas ${gemasCost} Gemas (tienes ${state.points} Gemas).`);
        return;
    }
    
    saveUserPoints(state.points - gemasCost);

    if (rewardId === 'coupon30') {
        state.activeCoupon = 30;
        localStorage.setItem('obs_coupon', '30');
        renderCart();
        showToast(`🎉 ¡Canjeado con éxito! Has activado un 🎫 Cupón del 30% de Descuento en la Tienda.`);
    } else {
        showToast(`🎉 ¡Canjeado con éxito! "${rewardName}" ha sido acreditado a tu cuenta.`);
    }
}

async function redeemPromoCode() {
    if (!state.username) {
        showToast('⚠️ Debes iniciar sesión para canjear códigos.');
        openModal('modal-login');
        return;
    }
    
    const inputEl = document.getElementById('promo-code-input');
    if (!inputEl) return;
    const code = inputEl.value.trim().toUpperCase();
    if (!code) {
        showToast('⚠️ Por favor ingresa un código.');
        return;
    }
    
    if (state.redeemedCodes.includes(code)) {
        showToast('❌ Ya has canjeado este código anteriormente.');
        inputEl.value = '';
        return;
    }

    // ── LOCK INMEDIATO: evita doble clic / carrera async ──────────
    state.redeemedCodes.push(code);
    localStorage.setItem('obs_redeemed_codes', JSON.stringify(state.redeemedCodes));
    const btn = document.querySelector('.mpb-btn');
    if (btn) { btn.disabled = true; btn.style.opacity = '0.5'; }
    inputEl.disabled = true;
    // ──────────────────────────────────────────────────────────────

    let reward = null;
    let isSupabaseCode = false;
    
    // Try to check Supabase
    if (supabaseClient) {
        try {
            // First check if already redeemed in Supabase
            const { data: existingRedemption, error: checkErr } = await supabaseClient
                .from('redeemed_codes')
                .select('*')
                .eq('username', state.username.toLowerCase())
                .eq('code', code)
                .maybeSingle();
                
            if (checkErr && checkErr.code !== 'PGRST116') {
                console.warn("Supabase check error:", checkErr);
            } else if (existingRedemption) {
                showToast('❌ Ya has canjeado este código anteriormente.');
                return;
            } else {
                // Fetch code from promo_codes table
                const { data: dbCode, error: fetchErr } = await supabaseClient
                    .from('promo_codes')
                    .select('*')
                    .eq('code', code)
                    .maybeSingle();
                    
                if (dbCode) {
                    if (dbCode.max_uses && dbCode.current_uses >= dbCode.max_uses) {
                        showToast('❌ Este código ha alcanzado el límite máximo de usos.');
                        return;
                    }
                    if (dbCode.expires_at && new Date(dbCode.expires_at) < new Date()) {
                        showToast('❌ Este código ha expirado.');
                        return;
                    }
                    
                    reward = {
                        type: dbCode.reward_type,
                        value: dbCode.reward_value,
                        name: dbCode.reward_name || 'Recompensa de Código'
                    };
                    isSupabaseCode = true;
                }
            }
        } catch(err) {
            console.warn("Supabase promo codes error:", err);
        }
    }
    
    // Fallback to local codes
    if (!reward) {
        const localPromoCodes = {
            'BIENVENIDA': { type: 'gems', value: 150, name: 'Bono de Bienvenida' },
            'PABLITOOP': { type: 'gems', value: 500, name: 'Regalo del Admin Pablito' },
            'OBSIDIAN500': { type: 'gems', value: 500, name: 'Gemas de Obsidian' },
            'KITVIP': { type: 'kit', value: 'Kit VIP Obsidian', name: 'Kit VIP de Regalo' },
            'OBSIDIANSMP': { type: 'frame', value: 'frame-obsidian', name: 'Marco de Obsidian Exclusivo' }
        };
        reward = localPromoCodes[code];
    }
    
    if (!reward) {
        // Rollback el lock: el codigo es invalido
        state.redeemedCodes = state.redeemedCodes.filter(c => c !== code);
        localStorage.setItem('obs_redeemed_codes', JSON.stringify(state.redeemedCodes));
        if (btn) { btn.disabled = false; btn.style.opacity = ''; }
        if (inputEl) inputEl.disabled = false;
        showToast('❌ Código canjeable inválido.');
        return;
    }
    
    // Apply reward
    if (reward.type === 'gems') {
        const amount = parseInt(reward.value) || 0;
        state.points = (state.points || 0) + amount;
        localStorage.setItem('obs_points', state.points);
        localStorage.setItem(`obs_points_${state.username.toLowerCase()}`, state.points);
        
        if (supabaseClient) {
            try {
                await supabaseClient
                    .from('user_profiles')
                    .update({ points: state.points })
                    .eq('username', state.username);
            } catch(e) {}
        }
        
        showToast(`🎉 ¡Código canjeado! Recibiste +${amount} Gemas (${reward.name}).`);
        syncUser();
    } else if (reward.type === 'frame') {
        const frameId = reward.value;
        if (!state.unlockedFrames.includes(frameId)) {
            state.unlockedFrames.push(frameId);
        }
        // Auto-equip if no frame active
        if (!state.activeFrame) {
            state.activeFrame = frameId;
        }
        saveUserDataToStorage();
        syncUser();
        showToast(`🛡️ ¡Marco desbloqueado! "${reward.name}" ya está disponible en tu perfil.`);
        renderMarketListings();
    } else if (reward.type === 'kit') {
        showToast(`🎉 ¡Código canjeado! Has obtenido: ${reward.value}.`);
        
        const sysMessage = {
            id: 'sys_' + Date.now(),
            buyer: 'Sistema',
            seller: state.username,
            status: 'accepted',
            messages: [{
                sender: 'Sistema',
                text: `🎁 Recompensa Canjeada: **${reward.value}** (${reward.name}). Ponte en contacto con el administrador Pablitorey_ para recibir tu recompensa in-game.`,
                time: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})
            }]
        };
        state.conversations.push(sysMessage);
        localStorage.setItem('obs_conversations', JSON.stringify(state.conversations));
        updateInboxBadge();
    }
    
    // (Redemption ya fue registrada antes de las operaciones async)
    
    // Track in Supabase (ya fue registrado localmente al inicio)
    if (supabaseClient) {
        try {
            await supabaseClient
                .from('redeemed_codes')
                .insert([{
                    username: state.username.toLowerCase(),
                    code: code,
                    reward_details: JSON.stringify(reward)
                }]);
                
            if (isSupabaseCode) {
                const { data: currentInfo } = await supabaseClient
                    .from('promo_codes')
                    .select('current_uses')
                    .eq('code', code)
                    .single();
                const newUses = (currentInfo?.current_uses || 0) + 1;
                await supabaseClient
                    .from('promo_codes')
                    .update({ current_uses: newUses })
                    .eq('code', code);
            }
        } catch(e) {}
    }
    
    inputEl.value = '';
    inputEl.disabled = false;
    if (btn) { btn.disabled = false; btn.style.opacity = ''; }
}

// ─── IP COPY ──────────────────────────────────────────────────
function copyIP() {
    const ip = 'PICOLANDNEWWORLD.aternos.me:51309';
    navigator.clipboard.writeText(ip).then(() => {
        showToast('📋 IP copiada: ' + ip);
    }).catch(() => {
        showToast('📋 IP del servidor: ' + ip);
    });
}

async function updateServerStatus() {
    const statusTextEl = document.querySelector('.ip-online');
    const liveDotEl = document.querySelector('.ip-live-dot');
    
    if (!statusTextEl || !liveDotEl) return;
    
    try {
        const res = await fetch('https://api.mcstatus.io/v2/status/java/PICOLANDNEWWORLD.aternos.me');
        if (!res.ok) throw new Error('API error');
        const data = await res.json();
        
        if (data.online) {
            const currentPlayers = data.players ? data.players.online : 0;
            statusTextEl.innerHTML = `<i class="fa-solid fa-signal"></i> ${currentPlayers} ONLINE`;
            statusTextEl.style.color = '#4ade80';
            liveDotEl.style.background = '#4ade80';
            liveDotEl.style.boxShadow = '0 0 8px #4ade80';
        } else {
            statusTextEl.innerHTML = `<i class="fa-solid fa-ban"></i> APAGADO`;
            statusTextEl.style.color = '#ef4444';
            liveDotEl.style.background = '#ef4444';
            liveDotEl.style.boxShadow = '0 0 8px #ef4444';
        }
    } catch (err) {
        console.error("Error fetching Minecraft server status:", err);
    }
}

function comingSoonTab(el, name) {
    showToast(`🚧 La sección "${name}" estará disponible pronto.`);
}

function showToast(msg) {
    const container = document.getElementById('toasts');
    if (!container) return;
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = msg;
    container.appendChild(t);
    setTimeout(() => {
        t.style.transition = 'all .3s ease';
        t.style.opacity = '0';
        t.style.transform = 'translateX(-110%)';
        setTimeout(() => t.remove(), 300);
    }, 3500);
}

// ─── MINECRAFT MARKETPLACE SYSTEM ─────────────────────────────
const CAT_LABELS = {
    armadura: '🛡️ Armadura',
    armas: '🗡️ Armas & Herramientas',
    comida: '🍏 Comida & Pociones',
    materiales: '🧱 Materiales & Bloques',
    libros: '📜 Libros & Tótems',
    shulkers: '📦 Shulkers & Cajas',
    cosmeticos: '🎨 Cosméticos & Varios'
};

function renderMarketplace() {
    const grid = document.getElementById('marketplace-grid');
    if (!grid) return;

    const cat = state.activeMarketCategory || 'all';
    const query = (state.marketSearchQuery || '').toLowerCase().trim();

    const filtered = (state.marketplaceListings || []).filter(item => {
        const matchesCat = (cat === 'all' ? item.category !== 'faccion' : item.category === cat);
        const matchesText = !query || 
            (item.title && item.title.toLowerCase().includes(query)) ||
            (item.desc && item.desc.toLowerCase().includes(query)) ||
            (item.price && item.price.toLowerCase().includes(query)) ||
            (item.publisher && item.publisher.toLowerCase().includes(query));

        return matchesCat && matchesText;
    });

    if (filtered.length === 0) {
        grid.innerHTML = `
            <div class="market-empty-state">
                <i class="fa-solid fa-store-slash"></i>
                <h3>No se encontraron publicaciones</h3>
                <p>Intenta cambiar los términos de búsqueda o selecciona otra categoría de Minecraft.</p>
            </div>
        `;
        return;
    }

    grid.innerHTML = filtered.map(item => {
        const catLabel = CAT_LABELS[item.category] || '📦 Ítem';
        const pubInfo = parsePublisher(item.publisher);
        const pubSkin = getPublisherAvatar(pubInfo, 28);
        let itemImg = item.image || 'img/shulker_void_3d.png';
        if (itemImg && !itemImg.startsWith('img/') && !itemImg.startsWith('data:') && !itemImg.startsWith('http') && !itemImg.startsWith('https')) {
            itemImg = 'img/' + itemImg;
        }

        const isOwner = (pubInfo.discordId 
            ? (pubInfo.discordId === state.discordId)
            : (pubInfo.username === state.username)) || isAdminUser();

        // Determine publisher avatar frame
        const isCurrentUser = (pubInfo.discordId ? pubInfo.discordId === state.discordId : pubInfo.username === state.username);
        const pubFrame = isCurrentUser ? state.activeFrame : '';
        const pubAvatarSrc = isCurrentUser && state.avatarSource === 'custom' && state.customAvatar
            ? state.customAvatar
            : pubSkin;

        const avatarFrameMarkup = getAvatarFrameHTML(pubAvatarSrc, pubFrame, {
            size: '32px',
            alt: pubInfo.username,
            onClick: `openUserProfileModal('${pubInfo.username.replace(/'/g, "\\'")}')`,
            extraWrapStyle: 'cursor:pointer;'
        });

        return `
            <div class="market-card" onclick="openListingDetailModal('${item.id}')">
                <div class="mc-img-wrap">
                    <img src="${itemImg}" alt="${item.title}" class="mc-img">
                    <span class="mc-cat-badge">${catLabel}</span>
                    <span class="mc-time-tag">${item.timeAgo || 'Reciente'}</span>
                </div>
                <div class="mc-card-body">
                    <h4 class="mc-title">${item.title}</h4>
                    <div class="mc-price-row">
                        <span class="mc-price-label">OFERTA:</span>
                        <span class="mc-price-val">${item.price}</span>
                    </div>
                    <p class="mc-desc">${item.desc}</p>
                    <div class="mc-publisher-row">
                        <div class="mc-user-info">
                            ${avatarFrameMarkup}
                            <span class="mc-username">${pubInfo.username}</span>
                        </div>
                        ${isOwner ? `
                        <button class="btn-contact-listing edit-btn" onclick="event.stopPropagation(); openEditListingModal('${item.id}')" style="background: #f59e0b;">
                            <i class="fa-solid fa-pen"></i> Editar
                        </button>
                        ` : `
                        <button class="btn-contact-listing" onclick="event.stopPropagation(); openContactModal('${item.publisher.replace(/'/g, "\\'")}', '${item.title.replace(/'/g, "\\'")}', '${item.id}')">
                            <i class="fa-solid fa-message"></i> Contactar
                        </button>
                        `}
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function setMarketCategory(catId) {
    state.activeMarketCategory = catId;
    document.querySelectorAll('.market-cat-pill').forEach(pill => {
        pill.classList.toggle('active', pill.dataset.cat === catId);
    });
    renderMarketplace();
}

function onMarketSearchChange(query) {
    state.marketSearchQuery = query;
    renderMarketplace();
}

function updateDescCharCounter(textarea) {
    const len = textarea.value.length;
    const counter = document.getElementById('market-desc-counter');
    if (!counter) return;

    counter.textContent = `${len} / 700 caracteres`;
    counter.classList.remove('warn', 'danger');

    if (len >= 650) {
        counter.classList.add('danger');
    } else if (len >= 500) {
        counter.classList.add('warn');
    }
}

function handleListingImageSelect(e) {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
        showToast('⚠️ La imagen excede el límite de 5MB.');
        return;
    }

    const reader = new FileReader();
    reader.onload = function(evt) {
        state.uploadedImageBase64 = evt.target.result;
        const preview = document.getElementById('market-img-preview');
        const previewWrap = document.getElementById('upload-preview-wrap');
        const prompt = document.getElementById('upload-prompt');

        if (preview && previewWrap && prompt) {
            preview.src = evt.target.result;
            previewWrap.style.display = 'block';
            prompt.style.display = 'none';
        }
    };
    reader.readAsDataURL(file);
}

function removeListingImage(e) {
    if (e) e.stopPropagation();
    state.uploadedImageBase64 = null;
    const fileInput = document.getElementById('market-input-file');
    const previewWrap = document.getElementById('upload-preview-wrap');
    const prompt = document.getElementById('upload-prompt');

    if (fileInput) fileInput.value = '';
    if (previewWrap) previewWrap.style.display = 'none';
    if (prompt) prompt.style.display = 'flex';
}

function handleCreateListingSubmit(e) {
    e.preventDefault();
    const title = document.getElementById('market-input-title')?.value.trim();
    const category = document.getElementById('market-input-cat')?.value;
    const price = document.getElementById('market-input-price')?.value.trim();
    const desc = document.getElementById('market-input-desc')?.value.trim();

    if (!title || !category || !price || !desc) {
        showToast('⚠️ Por favor completa todos los campos requeridos.');
        return;
    }

    if (desc.length > 700) {
        showToast('⚠️ La descripción no puede exceder los 700 caracteres.');
        return;
    }

    let publisher = state.username || 'Invitado';
    if (state.discordId) {
        publisher += '|' + state.discordId;
        if (state.discordUser && state.discordUser.avatar) {
            publisher += '|' + state.discordUser.avatar;
        } else {
            publisher += '|';
        }
    }
    const newListing = {
        id: 'm_' + Date.now(),
        title,
        category,
        price,
        desc,
        image: state.uploadedImageBase64 || 'img/shulker_void_3d.png',
        publisher,
        timeAgo: 'Hace un momento'
    };

    if (supabaseClient) {
        supabaseClient
            .from('listings')
            .insert([{
                id: newListing.id,
                title: newListing.title,
                category: newListing.category,
                price: newListing.price,
                desc_text: newListing.desc,
                image: newListing.image,
                publisher: newListing.publisher
            }])
            .then(({ error }) => {
                if (error) showToast('❌ Error de base de datos: ' + error.message);
            });
    } else {
        state.marketplaceListings.unshift(newListing);
        localStorage.setItem('obs_market_listings', JSON.stringify(state.marketplaceListings));
        renderMarketplace();
    }

    removeListingImage();
    document.getElementById('form-create-listing')?.reset();
    updateDescCharCounter(document.getElementById('market-input-desc'));
    closeModal('modal-create-listing');
    showToast('🎉 ¡Tu oferta ha sido publicada exitosamente en el Marketplace!');
}

function openListingDetailModal(listingId) {
    const item = (state.marketplaceListings || []).find(l => l.id === listingId);
    if (!item) return;

    const detailContainer = document.getElementById('market-detail-content');
    if (!detailContainer) return;

        const catLabel = CAT_LABELS[item.category] || '📦 Ítem';
    const pubInfo = parsePublisher(item.publisher);
    const pubSkin = getPublisherAvatar(pubInfo, 36);
    let itemImg = item.image || 'img/shulker_void_3d.png';
    if (itemImg && !itemImg.startsWith('img/') && !itemImg.startsWith('data:') && !itemImg.startsWith('http') && !itemImg.startsWith('https')) {
        itemImg = 'img/' + itemImg;
    }

    const isOwner = (pubInfo.discordId 
        ? (pubInfo.discordId === state.discordId)
        : (pubInfo.username === state.username)) || isAdminUser();

    detailContainer.innerHTML = `
        <img src="${itemImg}" alt="${item.title}" class="md-img">
        <div class="md-info">
            <span class="mc-cat-badge">${catLabel}</span>
            <h3 class="md-title">${item.title}</h3>
            <div class="md-price-box">OFERTA: ${item.price}</div>
            
            <div class="mc-publisher-row">
                <div class="mc-user-info">
                    <img src="${pubSkin}" alt="${pubInfo.username}" class="mc-user-avatar" style="width:36px;height:36px">
                    <div>
                        <span class="mc-username" style="font-size:.95rem">${pubInfo.username}</span>
                        <span style="font-size:.72rem;color:var(--text-muted);display:block">Publicado ${item.timeAgo}</span>
                    </div>
                </div>
            </div>

            <div class="md-desc">${item.desc}</div>

            ${isOwner
                ? `<button class="btn-copy-msg edit-btn" onclick="openEditListingModal('${item.id}')" style="background:#f59e0b; border:none; margin-top:1rem; width:100%;"><i class="fa-solid fa-pen"></i> Editar Oferta</button>`
                : `<button class="btn-copy-msg" onclick="openContactModal('${item.publisher.replace(/'/g, "\\'")}', '${item.title.replace(/'/g, "\\'")}', '${item.id}')" style="margin-top:1rem; width:100%;"><i class="fa-solid fa-message"></i> Enviar Mensaje</button>`
            }
        </div>
    `;

    openModal('modal-view-listing');
}

function copyContactMsg(publisher, title) {
    const cmd = `/msg ${publisher} Hola! Vi tu oferta de "${title}" en el Marketplace del sitio web.`;
    navigator.clipboard.writeText(cmd).then(() => {
        showToast(`📋 Comando copiado: <code>/msg ${publisher}...</code> ¡Pégalo in-game!`);
    }).catch(() => {
        showToast(`💬 Mensaje para ${publisher}: /msg ${publisher}`);
    });
}

// ─── MARKETPLACE EDITING ──────────────────────────────────────
function openEditListingModal(id) {
    const item = state.marketplaceListings.find(l => l.id === id);
    if (!item) return;

    document.getElementById('edit-listing-id').value = item.id;
    document.getElementById('edit-input-title').value = item.title;
    document.getElementById('edit-input-cat').value = item.category;
    document.getElementById('edit-input-price').value = item.price;
    document.getElementById('edit-input-desc').value = item.desc;
    
    updateEditDescCharCounter(document.getElementById('edit-input-desc'));
    openModal('modal-edit-listing');
}

function updateEditDescCharCounter(textarea) {
    const len = textarea.value.length;
    const counter = document.getElementById('edit-desc-counter');
    if (!counter) return;
    counter.textContent = `${len} / 700 caracteres`;
    counter.classList.remove('warn', 'danger');
    if (len >= 650) counter.classList.add('danger');
    else if (len >= 500) counter.classList.add('warn');
}

function handleEditListingSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('edit-listing-id').value;
    const title = document.getElementById('edit-input-title').value.trim();
    const category = document.getElementById('edit-input-cat').value;
    const price = document.getElementById('edit-input-price').value.trim();
    const desc = document.getElementById('edit-input-desc').value.trim();

    if (supabaseClient) {
        supabaseClient
            .from('listings')
            .update({
                title: title,
                category: category,
                price: price,
                desc_text: desc
            })
            .eq('id', id)
            .then(({ error }) => {
                if (error) showToast('❌ Error de base de datos: ' + error.message);
            });
    } else {
        const idx = state.marketplaceListings.findIndex(l => l.id === id);
        if (idx !== -1) {
            state.marketplaceListings[idx] = {
                ...state.marketplaceListings[idx],
                title, category, price, desc
            };
            localStorage.setItem('obs_market_listings', JSON.stringify(state.marketplaceListings));
            renderMarketplace();
        }
    }

    closeModal('modal-edit-listing');
    showToast('✅ ¡Publicación actualizada correctamente!');
    closeModal('modal-view-listing'); // If it was open
}

// ─── INBOX & CHAT SYSTEM ──────────────────────────────────────
let activeChatId = null;
let currentInboxTab = 'pending';

function updateInboxBadge() {
    const badge = document.getElementById('inbox-badge');
    if (!badge || !state.username) return;

    const pendingChats = state.conversations.filter(c => c.seller === state.username && c.status === 'pending');
    if (pendingChats.length > 0) {
        badge.textContent = pendingChats.length;
        badge.style.display = 'inline-block';
    } else {
        badge.style.display = 'none';
    }
}

function openContactModal(publisher, title, listingId) {
    if (!state.username) {
        showToast('⚠️ Debes iniciar sesión para enviar mensajes.');
        openModal('modal-login');
        return;
    }
    if (publisher === state.username) {
        showToast('⚠️ No puedes enviarte un mensaje a ti mismo.');
        return;
    }
    
    // Check if conversation already exists
    const existing = state.conversations.find(c => c.listingId === listingId && c.buyer === state.username && c.seller === publisher);
    if (existing) {
        showToast('💬 Ya tienes una conversación sobre esta oferta. Revisa tu Buzón.');
        return;
    }

    document.getElementById('send-msg-subtitle').textContent = `Enviar mensaje a ${publisher} por "${title}"`;
    document.getElementById('send-msg-listing-id').value = listingId;
    document.getElementById('send-msg-receiver').value = publisher;
    document.getElementById('send-msg-text').value = '';
    openModal('modal-send-message');
}

function submitFirstMessage() {
    const text = document.getElementById('send-msg-text').value.trim();
    const listingId = document.getElementById('send-msg-listing-id').value;
    const seller = document.getElementById('send-msg-receiver').value;

    if (!text) {
        showToast('⚠️ Escribe un mensaje.');
        return;
    }

    const newConv = {
        id: 'conv_' + Date.now(),
        listingId,
        buyer: state.username,
        seller: seller,
        status: 'pending',
        messages: [{
            sender: state.username,
            text,
            time: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})
        }]
    };

    if (supabaseClient) {
        supabaseClient
            .from('conversations')
            .insert([{
                id: newConv.id,
                listing_id: newConv.listingId,
                buyer: newConv.buyer,
                seller: newConv.seller,
                status: newConv.status,
                messages: newConv.messages
            }])
            .then(({ error }) => {
                if (error) showToast('❌ Error de base de datos: ' + error.message);
            });
    }
    
    state.conversations.push(newConv);
    localStorage.setItem('obs_conversations', JSON.stringify(state.conversations));
    updateInboxBadge();
    
    closeModal('modal-send-message');
    showToast('✅ ¡Mensaje enviado! El vendedor recibirá tu solicitud.');
}

function openInboxModal() {
    if (!state.username) {
        showToast('⚠️ Debes iniciar sesión para ver tu buzón.');
        openModal('modal-login');
        return;
    }
    setInboxTab('pending');
    openModal('modal-inbox');
}

function setInboxTab(tab) {
    currentInboxTab = tab;
    
    const pendBtn = document.getElementById('tab-inbox-pending');
    const actBtn = document.getElementById('tab-inbox-active');
    
    if (pendBtn && actBtn) {
        if (tab === 'pending') {
            pendBtn.style.background = 'rgba(168,85,247,0.35)';
            pendBtn.style.color = '#fff';
            actBtn.style.background = 'transparent';
            actBtn.style.color = 'var(--text-muted)';
        } else {
            actBtn.style.background = 'rgba(168,85,247,0.35)';
            actBtn.style.color = '#fff';
            pendBtn.style.background = 'transparent';
            pendBtn.style.color = 'var(--text-muted)';
        }
    }
    
    activeChatId = null;
    renderInboxList();
    renderChatMessages();
}

function renderInboxList() {
    const list = document.getElementById('inbox-list');
    
    const chats = state.conversations.filter(c => {
        const isParticipant = (c.buyer === state.username || c.seller === state.username);
        if (!isParticipant) return false;
        return currentInboxTab === 'pending' ? c.status === 'pending' : c.status === 'active';
    });

    if (chats.length === 0) {
        list.innerHTML = `<div style="padding:1rem;color:var(--text-muted);text-align:center;">No tienes conversaciones aquí.</div>`;
        return;
    }

    list.innerHTML = chats.map(c => {
        const otherUser = c.buyer === state.username ? c.seller : c.buyer;
        const lastMsg = c.messages[c.messages.length - 1];
        const isActive = c.id === activeChatId ? 'background:rgba(255,255,255,0.1);' : '';
        const item = state.marketplaceListings.find(l => l.id === c.listingId);
        const itemTitle = item ? item.title : 'Publicación eliminada';

        return `
            <div style="padding: 1rem; border-bottom: 1px solid rgba(255,255,255,0.05); cursor: pointer; ${isActive}" onclick="openChat('${c.id}')">
                <div style="font-weight:bold; color: white;">${otherUser}</div>
                <div style="font-size: 0.8rem; color: #f59e0b; margin-bottom: 4px;">Oferta: ${itemTitle}</div>
                <div style="font-size: 0.85rem; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                    ${lastMsg.sender === state.username ? 'Tú: ' : ''}${lastMsg.text}
                </div>
            </div>
        `;
    }).join('');
}

function openChat(id) {
    activeChatId = id;
    renderInboxList();
    renderChatMessages();
}

function renderChatMessages() {
    const header = document.getElementById('chat-header');
    const msgsBox = document.getElementById('chat-messages');
    const inputArea = document.getElementById('chat-input-area');

    if (!activeChatId) {
        header.innerHTML = `<span style="color: var(--text-muted);">Selecciona una conversación para empezar a chatear.</span>`;
        msgsBox.innerHTML = '';
        inputArea.style.display = 'none';
        return;
    }

    const c = state.conversations.find(conv => conv.id === activeChatId);
    if (!c) return;

    const otherUser = c.buyer === state.username ? c.seller : c.buyer;
    header.innerHTML = `
        <img src="https://mc-heads.net/avatar/${encodeURIComponent(otherUser)}/32" style="border-radius:4px; width:32px; height:32px;">
        <strong style="color:white; font-size:1.1rem;">${otherUser}</strong>
        ${c.status === 'pending' ? `<span style="background:#ef4444; padding:2px 6px; border-radius:4px; font-size:0.75rem; margin-left:auto;">Solicitud Pendiente</span>` : ''}
    `;

    msgsBox.innerHTML = c.messages.map(m => {
        const isMe = m.sender === state.username;
        return `
            <div style="display:flex; flex-direction:column; align-items: ${isMe ? 'flex-end' : 'flex-start'};">
                <div style="background: ${isMe ? '#4ade80' : 'rgba(255,255,255,0.1)'}; color: ${isMe ? '#000' : '#fff'}; padding: .6rem 1rem; border-radius: 12px; max-width: 80%; margin-bottom: 2px;">
                    ${m.text}
                </div>
                <span style="font-size:0.7rem; color:var(--text-muted); margin:0 4px;">${m.time}</span>
            </div>
        `;
    }).join('');

    msgsBox.scrollTop = msgsBox.scrollHeight;

    if (c.status === 'pending') {
        if (c.buyer === state.username) {
            inputArea.style.display = 'none';
            msgsBox.innerHTML += `<div style="text-align:center; color:var(--text-muted); font-size:0.85rem; margin-top:1rem;">Esperando a que el líder responda...</div>`;
        } else if (c.listingId && c.listingId.startsWith('fac_')) {
            inputArea.style.display = 'none';
            msgsBox.innerHTML += `
                <div id="faction-request-actions" style="text-align:center; padding:1.2rem; background:rgba(255,255,255,0.03); border:1.5px dashed rgba(255,255,255,0.1); border-radius:12px; margin-top:1.5rem;">
                    <h4 style="color:white; font-family:'Outfit', sans-serif; margin-bottom:0.4rem;"><i class="fa-solid fa-shield-halved" style="color:var(--primary);"></i> Solicitud de Unión a tu Clan</h4>
                    <p style="font-size:0.8rem; color:var(--text-muted); margin-bottom:1rem;">Esta persona quiere unirse a tu facción. El límite de miembros aumentará si aceptas (máx 8).</p>
                    <div style="display:flex; gap:0.8rem; justify-content:center;">
                        <button class="btn-mc btn-green-mc" onclick="acceptFactionRequest('${c.id}')" style="padding:0.5rem 1.2rem; font-size:0.8rem; width:auto; margin:0; cursor:pointer;"><i class="fa-solid fa-check"></i> ACEPTAR</button>
                        <button class="btn-mc btn-dark-mc" onclick="rejectFactionRequest('${c.id}')" style="padding:0.5rem 1.2rem; font-size:0.8rem; width:auto; margin:0; border-color:#991b1b; color:#f87171; cursor:pointer;"><i class="fa-solid fa-xmark"></i> RECHAZAR</button>
                    </div>
                </div>
            `;
        } else {
            inputArea.style.display = 'flex';
            setTimeout(() => document.getElementById('chat-reply-text').focus(), 100);
        }
    } else {
        inputArea.style.display = 'flex';
        setTimeout(() => document.getElementById('chat-reply-text').focus(), 100);
    }
}

function replyChat() {
    const inp = document.getElementById('chat-reply-text');
    const text = inp.value.trim();
    if (!text || !activeChatId) return;

    const c = state.conversations.find(conv => conv.id === activeChatId);
    if (!c) return;

    const newMessages = [...c.messages, {
        sender: state.username,
        text,
        time: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})
    }];
    const newStatus = (c.status === 'pending' && c.seller === state.username) ? 'active' : c.status;

    if (supabaseClient) {
        supabaseClient
            .from('conversations')
            .update({ 
                messages: newMessages, 
                status: newStatus,
                updated_at: new Date()
            })
            .eq('id', c.id)
            .then(({ error }) => {
                if (error) showToast('❌ Error de base de datos: ' + error.message);
            });
    }

    c.status = newStatus;
    c.messages = newMessages;
    localStorage.setItem('obs_conversations', JSON.stringify(state.conversations));
    
    inp.value = '';
    
    if (currentInboxTab === 'pending' && c.status === 'active') {
        activeChatId = c.id; 
        setInboxTab('active');
    } else {
        renderInboxList();
        renderChatMessages();
    }
    updateInboxBadge();
}

// Intercept syncUser to also update badge
const originalSyncUser = syncUser;
syncUser = function() {
    originalSyncUser();
    updateInboxBadge();
}
setTimeout(() => updateInboxBadge(), 1000);

// ─── DELETE LISTING ───────────────────────────────────────────
function deleteListing(id) {
    const listingId = id || document.getElementById('edit-listing-id')?.value;
    if (!listingId) return;

    const item = state.marketplaceListings.find(l => l.id === listingId);
    if (item) {
        const pubInfo = parsePublisher(item.publisher);
        const isOwner = (pubInfo.discordId 
            ? (pubInfo.discordId === state.discordId)
            : (pubInfo.username === state.username)) || isAdminUser();
        if (!isOwner) {
            showToast('⚠️ No tienes permiso para eliminar esta publicación.');
            return;
        }
    }

    closeModal('modal-edit-listing');

    setTimeout(() => {
        customConfirm(
            '¿Eliminar publicación?',
            'Esta acción no se puede deshacer. La publicación desaparecerá del marketplace para todos los jugadores.',
            () => {
                state.marketplaceListings = state.marketplaceListings.filter(l => l.id !== listingId);
                localStorage.setItem('obs_market_listings', JSON.stringify(state.marketplaceListings));

                if (supabaseClient) {
                    supabaseClient
                        .from('listings')
                        .delete()
                        .eq('id', listingId)
                        .then(({ error }) => {
                            if (error) showToast('❌ Error al eliminar: ' + error.message);
                        });
                }

                closeModal('modal-view-listing');
                renderMarketplace();
                showToast('🗑️ Publicación eliminada.');
            }
        );
    }, 150);
}

// ─── LOGIN SIN DISCORD (RECOBRAR CUENTA CON CONTRASEÑA DE 2 PASOS) ───
function showPasswordLoginView() {
    const discordView = document.getElementById('discord-auth-view');
    const passLoginView = document.getElementById('mc-password-login-view');
    const linkView = document.getElementById('minecraft-link-view');
    const profileView = document.getElementById('profile-settings-view');
    
    if (discordView) discordView.style.display = 'none';
    if (linkView) linkView.style.display = 'none';
    if (profileView) profileView.style.display = 'none';
    if (passLoginView) passLoginView.style.display = 'block';
}

function showDiscordAuthView() {
    const discordView = document.getElementById('discord-auth-view');
    const passLoginView = document.getElementById('mc-password-login-view');
    const linkView = document.getElementById('minecraft-link-view');
    const profileView = document.getElementById('profile-settings-view');
    
    if (discordView) discordView.style.display = 'block';
    if (linkView) linkView.style.display = 'none';
    if (profileView) profileView.style.display = 'none';
    if (passLoginView) passLoginView.style.display = 'none';
}

async function loginWithPasswordOnly() {
    const userInp = document.getElementById('pass-login-username');
    const passInp = document.getElementById('pass-login-password');
    const u = userInp?.value.trim();
    const p = passInp?.value.trim();
    
    if (!u) { showToast('⚠️ Ingresa tu usuario de Minecraft.'); return; }
    if (!p) { showToast('⚠️ Ingresa tu contraseña de 2-Pasos.'); return; }
    
    const btn = document.getElementById('pass-login-submit-btn');
    const origText = btn ? btn.innerHTML : 'INICIAR SESIÓN';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> VERIFICANDO...';
    }
    
    if (supabaseClient) {
        try {
            const { data, error } = await supabaseClient
                .from('conversations')
                .select('*')
                .eq('listing_id', 'registration')
                .eq('buyer', u.toLowerCase());
            
            if (error) throw error;
            
            if (data && data.length > 0) {
                const reg = data[0];
                const storedPass = reg.messages && reg.messages[0] ? reg.messages[0].replace('pass:', '') : '';
                
                if (storedPass === 'none') {
                    showToast('❌ Esta cuenta no tiene contraseña de 2-Pasos configurada. Debes iniciar sesión con Discord.');
                } else if (p === storedPass) {
                    // Login exitoso!
                    state.username = reg.buyer;
                    state.discordId = reg.seller; // ID de Discord enlazado
                    state.discordTag = 'Acceso sin Discord';
                    
                    // Guardamos localmente
                    localStorage.setItem(`obs_mc_user_${reg.seller}`, reg.buyer);
                    localStorage.setItem('obs_user', reg.buyer);
                    localStorage.setItem('obs_logged_without_discord_user', reg.buyer);
                    localStorage.setItem('obs_logged_without_discord_id', reg.seller);
                    
                    // Cargar perfil completo (gemas, marcos, etc.)
                    loadUserDataOnLogin(reg.seller, reg.buyer);
                    
                    closeModal('modal-login');
                    showToast(`✅ Bienvenido de nuevo, ${reg.buyer}!`);
                    loadInitialDatabaseData();
                } else {
                    showToast('❌ Contraseña de 2-Pasos incorrecta.');
                }
            } else {
                showToast('❌ Usuario de Minecraft no encontrado.');
            }
        } catch(err) {
            console.error("Error logging in with password:", err);
            showToast('❌ Error de conexión al verificar la cuenta.');
        }
    } else {
        showToast('❌ Error de base de datos no configurada.');
    }
    
    if (btn) {
        btn.disabled = false;
        btn.innerHTML = origText;
    }
}

// ─── FACTIONS (CLANS / TEAMS) SYSTEM ──────────────────────────
let factionUploadedImageBase64 = null;

function openFactionEditorModal(factionId) {
    if (!state.username) {
        showToast('⚠️ Debes iniciar sesión con Discord/Contraseña para registrar un clan.');
        openModal('modal-login');
        return;
    }
    
    // Reset form
    document.getElementById('faction-editor-form').reset();
    document.getElementById('faction-edit-id').value = '';
    document.getElementById('fac-input-frame').value = 'frame-iron';
    factionUploadedImageBase64 = null;
    document.getElementById('fac-file-name').textContent = 'Sin archivo cargado';
    document.getElementById('fac-btn-delete-img').style.display = 'none';
    document.getElementById('faction-desc-counter').textContent = '0 / 700 caracteres';
    
    const titleEl = document.getElementById('faction-editor-title');
    const leaderInput = document.getElementById('fac-input-leader');
    leaderInput.value = state.username;
    
    if (factionId) {
        titleEl.textContent = 'Editar Clan';
        const item = state.marketplaceListings.find(l => l.id === factionId);
        if (item && item.desc.startsWith('FACDATA:')) {
            const data = JSON.parse(item.desc.substring(8));
            document.getElementById('faction-edit-id').value = item.id;
            document.getElementById('fac-input-name').value = item.title;
            document.getElementById('fac-input-tag').value = data.tag || '';
            document.getElementById('fac-input-type').value = data.type || 'PvP';
            document.getElementById('fac-input-recruitment').value = data.recruiting || 'Abierto';
            document.getElementById('fac-input-leader').value = data.leader || item.publisher;
            document.getElementById('fac-input-officers').value = data.officers || '';
            document.getElementById('fac-input-members').value = data.memberCount || 1;
            document.getElementById('fac-input-max').value = data.maxMembers || 8;
            document.getElementById('fac-input-gear').value = data.minGear || 'Ninguno';
            document.getElementById('fac-input-discord').value = data.discord || '';
            document.getElementById('fac-input-diplomacy').value = data.alliesEnemies || '';
            document.getElementById('fac-input-frame').value = data.frame || 'frame-iron';
            document.getElementById('fac-input-desc').value = data.description || '';
            
            updateFactionDescCharCounter(document.getElementById('fac-input-desc'));
            
            if (item.image) {
                factionUploadedImageBase64 = item.image;
                document.getElementById('fac-file-name').textContent = 'Foto actual del clan cargada';
                document.getElementById('fac-btn-delete-img').style.display = 'inline-flex';
            }
        }
    } else {
        titleEl.textContent = 'Registrar Clan';
    }
    
    openModal('modal-faction-editor');
}

function uploadFactionImage(input) {
    const file = input.files[0];
    if (!file) return;
    
    if (file.size > 2 * 1024 * 1024) {
        showToast('⚠️ La imagen supera el límite de 2MB.');
        input.value = '';
        return;
    }
    
    const reader = new FileReader();
    reader.onload = function(e) {
        factionUploadedImageBase64 = e.target.result;
        document.getElementById('fac-file-name').textContent = file.name;
        document.getElementById('fac-btn-delete-img').style.display = 'inline-flex';
        showToast('📸 Foto del clan cargada correctamente.');
    };
    reader.readAsDataURL(file);
}

function deleteFactionImage() {
    factionUploadedImageBase64 = null;
    document.getElementById('fac-input-file').value = '';
    document.getElementById('fac-file-name').textContent = 'Foto eliminada';
    document.getElementById('fac-btn-delete-img').style.display = 'none';
    showToast('🗑️ Foto del clan removida.');
}

function updateFactionDescCharCounter(textarea) {
    const len = textarea.value.length;
    const counter = document.getElementById('faction-desc-counter');
    if (counter) counter.textContent = `${len} / 700 caracteres`;
}

async function handleFactionSubmit(e) {
    e.preventDefault();
    if (!state.username) return;
    
    const id = document.getElementById('faction-edit-id').value;
    const name = document.getElementById('fac-input-name').value.trim();
    const tag = document.getElementById('fac-input-tag').value.trim().toUpperCase();
    const type = document.getElementById('fac-input-type').value;
    const recruiting = document.getElementById('fac-input-recruitment').value;
    const leader = document.getElementById('fac-input-leader').value.trim();
    const officers = document.getElementById('fac-input-officers').value.trim();
    const memberCount = parseInt(document.getElementById('fac-input-members').value) || 1;
    const maxMembers = parseInt(document.getElementById('fac-input-max').value) || 8;
    const minGear = document.getElementById('fac-input-gear').value;
    const discord = document.getElementById('fac-input-discord').value.trim();
    const alliesEnemies = document.getElementById('fac-input-diplomacy').value.trim();
    const frame = document.getElementById('fac-input-frame').value;
    const description = document.getElementById('fac-input-desc').value.trim();
    
    if (maxMembers > 8) {
        showToast('⚠️ El límite máximo es de 8 miembros.');
        return;
    }
    if (memberCount > maxMembers) {
        showToast('⚠️ El número de miembros actual no puede superar el límite.');
        return;
    }
    
    const factionData = {
        description, tag, type, recruiting, leader, officers,
        memberCount, maxMembers, minGear, discord, alliesEnemies, frame
    };
    
    const serializedDesc = "FACDATA:" + JSON.stringify(factionData);
    const publisherVal = leader;
    const finalId = id || 'fac_' + Date.now();
    
    const dbRecord = {
        id: finalId,
        title: name,
        category: 'faccion',
        price: tag,
        desc_text: serializedDesc,
        image: factionUploadedImageBase64,
        publisher: state.discordId ? `${publisherVal}|${state.discordId}|${state.discordUser?.avatar || ''}` : publisherVal
    };
    
    if (supabaseClient) {
        try {
            if (id) {
                // Update
                const { error } = await supabaseClient
                    .from('listings')
                    .update({
                        title: dbRecord.title,
                        desc_text: dbRecord.desc_text,
                        image: dbRecord.image,
                        price: dbRecord.price
                    })
                    .eq('id', id);
                if (error) throw error;
            } else {
                // Insert
                const { error } = await supabaseClient
                    .from('listings')
                    .insert([dbRecord]);
                if (error) throw error;
            }
            showToast('✅ ¡Clan guardado exitosamente en la nube!');
        } catch(err) {
            console.error("Error al guardar clan en Supabase:", err);
            showToast('❌ Error de conexión al guardar el clan.');
        }
    }
    
    // Fallback/Local sync
    const idx = state.marketplaceListings.findIndex(l => l.id === finalId);
    const localItem = {
        id: finalId,
        title: name,
        category: 'faccion',
        price: tag,
        desc: serializedDesc,
        image: factionUploadedImageBase64,
        publisher: dbRecord.publisher,
        timeAgo: 'Hace un momento'
    };
    
    if (idx !== -1) {
        state.marketplaceListings[idx] = localItem;
    } else {
        state.marketplaceListings.unshift(localItem);
    }
    
    localStorage.setItem('obs_market_listings', JSON.stringify(state.marketplaceListings));
    
    closeModal('modal-faction-editor');
    renderFactions();
}

function renderFactions() {
    const grid = document.getElementById('factions-grid');
    if (!grid) return;
    
    // Purge mock demo factions if present in local state
    state.marketplaceListings = (state.marketplaceListings || []).filter(item => !/^fac_(obsidian_imperium|sombras|gladiadores)$/.test(item.id));
    localStorage.setItem('obs_market_listings', JSON.stringify(state.marketplaceListings));

    const query = (document.getElementById('faction-search')?.value || '').toLowerCase().trim();
    
    const factions = state.marketplaceListings.filter(item => {
        if (item.category !== 'faccion') return false;
        
        if (!query) return true;
        
        let matches = item.title.toLowerCase().includes(query) || item.price.toLowerCase().includes(query);
        if (item.desc && item.desc.startsWith('FACDATA:')) {
            try {
                const data = JSON.parse(item.desc.substring(8));
                matches = matches || 
                          (data.description && data.description.toLowerCase().includes(query)) ||
                          (data.type && data.type.toLowerCase().includes(query)) ||
                          (data.leader && data.leader.toLowerCase().includes(query));
            } catch(e) {}
        }
        return matches;
    });
    
    if (factions.length === 0) {
        grid.innerHTML = `
            <div class="market-empty-state" style="grid-column: 1 / -1; padding: 4rem 1rem; text-align: center;">
                <i class="fa-solid fa-flag-question" style="font-size: 3rem; color: var(--primary); opacity: 0.7; margin-bottom: 1rem;"></i>
                <h3 style="color: #fff; margin-bottom: 0.5rem;">No se encontraron clanes</h3>
                <p style="color: var(--text-dim);">¡Sé el primero en fundar un imperio en el servidor! Haz clic en <strong>"REGISTRAR TU CLAN"</strong> arriba.</p>
            </div>
        `;
        return;
    }
    
    const bannerUrl = 'img/fondo1.jpg';
    
    grid.innerHTML = factions.map((item, index) => {
        let data = {};
        if (item.desc && item.desc.startsWith('FACDATA:')) {
            try {
                data = JSON.parse(item.desc.substring(8));
            } catch(e) {}
        }
        
        const logoUrl = item.image || 'img/obsidian.png';
        const specialty = data.type || 'Supervivencia';
        const members = data.memberCount || 1;
        const max = data.maxMembers || 15;
        const recruitment = data.recruiting || 'Abierto';
        const recruitmentClass = recruitment === 'Abierto' ? 'rec-open' : (recruitment === 'Cerrado' ? 'rec-closed' : 'rec-invite');
        const frameClass = data.frame || 'frame-iron';
        
        return `
            <div class="faction-card" onclick="openFactionDetailModal('${item.id}')">
                <div class="faction-card-header" style="background-image: url('${bannerUrl}')">
                    <div class="header-overlay"></div>
                    <span class="recruitment-badge ${recruitmentClass}">${recruitment.toUpperCase()}</span>
                </div>
                <div class="faction-card-crest ${frameClass}">
                    <div class="steam-ring"></div>
                    <div class="steam-glow"></div>
                    <img src="${logoUrl}" alt="Escudo Clan" class="crest-img">
                    <div class="steam-particles">
                        <span></span><span></span><span></span>
                    </div>
                </div>
                <div class="faction-card-body">
                    <h4 class="faction-card-title">${item.title} <span class="faction-tag">[${item.price}]</span></h4>
                    <span class="faction-specialty"><i class="fa-solid fa-khanda"></i> ${specialty}</span>
                    <p class="faction-summary-desc">${data.description || 'Sin descripción.'}</p>
                    
                    <div class="faction-stats-row">
                        <div class="f-stat-item">
                            <span class="f-stat-val">${data.leader || 'Nadie'}</span>
                            <span class="f-stat-lbl">LÍDER</span>
                        </div>
                        <div class="f-stat-item">
                            <span class="f-stat-val">${members}/${max}</span>
                            <span class="f-stat-lbl">MIEMBROS</span>
                        </div>
                        <div class="f-stat-item">
                            <span class="f-stat-val">${data.minGear || 'Ninguno'}</span>
                            <span class="f-stat-lbl">EQUIPO MÍN.</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function onFactionSearchChange(q) {
    renderFactions();
}

function openFactionDetailModal(factionId) {
    const item = state.marketplaceListings.find(l => l.id === factionId);
    if (!item) return;
    
    let data = {};
    if (item.desc && item.desc.startsWith('FACDATA:')) {
        try {
            data = JSON.parse(item.desc.substring(8));
        } catch(e) {}
    }
    
    const bannerUrl = 'img/fondo1.jpg';
    
    const detailContainer = document.getElementById('faction-detail-content');
    if (!detailContainer) return;
    
    const logoUrl = item.image || 'img/obsidian.png';
    const recruitment = data.recruiting || 'Abierto';
    const recruitmentClass = recruitment === 'Abierto' ? 'rec-open' : (recruitment === 'Cerrado' ? 'rec-closed' : 'rec-invite');
    const frameClass = data.frame || 'frame-iron';
    
    const pubInfo = parsePublisher(item.publisher);
    const isOwner = pubInfo.discordId 
        ? (pubInfo.discordId === state.discordId)
        : (pubInfo.username === state.username);
        
    const isAdmin = isAdminUser();
    const canManage = isOwner || isAdmin;
    
    let joinBtnHtml = '';
    if (state.username && !canManage) {
        const applicantName = state.username.toLowerCase();
        const existingRequest = state.conversations.find(c => c.listingId === item.id && c.buyer.toLowerCase() === applicantName);
        
        if (existingRequest) {
            if (existingRequest.status === 'pending') {
                joinBtnHtml = `<button class="btn-mc btn-dark-mc width-100" style="margin-top: 1rem; padding: 0.6rem;" disabled><i class="fa-solid fa-spinner fa-spin"></i> SOLICITUD PENDIENTE</button>`;
            } else if (existingRequest.status === 'accepted') {
                joinBtnHtml = `<button class="btn-mc btn-green-mc width-100" style="margin-top: 1rem; padding: 0.6rem;" disabled><i class="fa-solid fa-check"></i> YA ERES MIEMBRO</button>`;
            } else if (existingRequest.status === 'rejected') {
                joinBtnHtml = `<button class="btn-mc btn-dark-mc width-100" style="margin-top: 1rem; padding: 0.6rem;" disabled><i class="fa-solid fa-xmark" style="color:#ef4444;"></i> SOLICITUD RECHAZADA</button>`;
            }
        } else {
            joinBtnHtml = `<button class="btn-mc btn-green-mc width-100" onclick="sendJoinRequest('${item.id}')" style="margin-top: 1rem; padding: 0.6rem;"><i class="fa-solid fa-plus"></i> ENVIAR SOLICITUD</button>`;
        }
    } else if (!state.username) {
        joinBtnHtml = `<button class="btn-mc btn-purple-mc width-100" onclick="openModal('modal-login')" style="margin-top: 1rem; padding: 0.6rem;"><i class="fa-solid fa-right-to-bracket"></i> LOGUEATE PARA UNIRTE</button>`;
    }

    detailContainer.innerHTML = `
        <div class="fd-banner" style="background-image: url('${bannerUrl}')">
            <div class="fd-banner-overlay"></div>
            <div class="fd-crest ${frameClass}">
                <div class="steam-ring"></div>
                <div class="steam-glow"></div>
                <img src="${logoUrl}" alt="Crest">
                <div class="steam-particles">
                    <span></span><span></span><span></span>
                </div>
            </div>
            <span class="recruitment-badge ${recruitmentClass}" style="position: absolute; bottom: 15px; right: 20px;">${recruitment.toUpperCase()}</span>
        </div>
        
        <div class="fd-main-body" style="padding: 1.5rem 2rem;">
            <div class="fd-split-layout">
                <!-- Left Details Grid -->
                <div class="fd-details-sidebar">
                    <h3 class="fd-title">${item.title} <span class="faction-tag">[${item.price}]</span></h3>
                    <span class="faction-specialty" style="margin-bottom: 1rem; display: inline-block;"><i class="fa-solid fa-khanda"></i> ${data.type || 'Mixto'}</span>
                    
                    <div class="fd-spec-grid">
                        <div class="fd-spec-item">
                            <strong>Líder:</strong>
                            <span>${data.leader || 'Nadie'}</span>
                        </div>
                        <div class="fd-spec-item">
                            <strong>Oficiales:</strong>
                            <span>${data.officers || 'Ninguno'}</span>
                        </div>
                        <div class="fd-spec-item">
                            <strong>Miembros:</strong>
                            <span>${data.memberCount || 1} / ${data.maxMembers || 8}</span>
                        </div>
                        <div class="fd-spec-item">
                            <strong>Armas Mínimas:</strong>
                            <span>${data.minGear || 'Ninguno'}</span>
                        </div>
                    </div>
                    
                    ${data.discord ? `
                    <a href="${data.discord}" target="_blank" class="btn-mc btn-purple-mc width-100" style="margin-top: 1rem; text-decoration: none; padding: 0.6rem; text-align: center;">
                        <i class="fa-brands fa-discord"></i> DISCORD DEL CLAN
                    </a>
                    ` : ''}
                    ${joinBtnHtml}
                </div>
                
                <!-- Right Main Manifesto -->
                <div class="fd-manifesto-column">
                    <h4 class="fd-sub-header">Manifiesto &amp; Objetivos</h4>
                    <p class="fd-description">${data.description || 'Sin manifiesto cargado.'}</p>
                    
                    <h4 class="fd-sub-header" style="margin-top: 1.2rem;">Relaciones Diplomáticas</h4>
                    <p class="fd-description" style="color: #fda4af; font-weight: 700;">${data.alliesEnemies || 'Manteniendo neutralidad absoluta.'}</p>
                    
                    ${canManage ? `
                    <div style="display: flex; gap: 0.8rem; margin-top: 2rem; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 1rem;">
                        <button class="btn-mc btn-purple-mc" onclick="closeModal('modal-view-faction'); openFactionEditorModal('${item.id}')" style="flex: 1; padding: 0.6rem;">
                            <i class="fa-solid fa-pen"></i> Editar Clan
                        </button>
                        <button class="btn-mc btn-dark-mc" onclick="deleteFaction('${item.id}')" style="flex: 1; padding: 0.6rem; border-color: #991b1b; color: #f87171;">
                            <i class="fa-solid fa-trash"></i> Disolver Clan
                        </button>
                    </div>
                    ` : ''}
                </div>
            </div>
        </div>
    `;
    
    openModal('modal-view-faction');
}

function deleteFaction(factionId) {
    customConfirm(
        '¿Disolver Facción?',
        '¿Estás seguro de disolver este clan? Se borrará de la base de datos y perderán todas sus diplomacias.',
        async () => {
            if (supabaseClient) {
                try {
                    const { error } = await supabaseClient
                        .from('listings')
                        .delete()
                        .eq('id', factionId);
                    if (error) throw error;
                    showToast('🗑️ Clan disuelto exitosamente de la base de datos.');
                } catch(e) {
                    console.error("Error al borrar clan en Supabase:", e);
                    showToast('❌ Error de conexión al disolver el clan.');
                }
            }
            
            state.marketplaceListings = state.marketplaceListings.filter(l => l.id !== factionId);
            localStorage.setItem('obs_market_listings', JSON.stringify(state.marketplaceListings));
            
            closeModal('modal-view-faction');
            renderFactions();
        }
    );
}

async function sendJoinRequest(factionId) {
    if (!state.username) {
        showToast('⚠️ Debes iniciar sesión para enviar una solicitud de unión.');
        openModal('modal-login');
        return;
    }
    
    const faction = state.marketplaceListings.find(l => l.id === factionId);
    if (!faction) return;
    
    const leaderInfo = parsePublisher(faction.publisher);
    const leaderName = leaderInfo.username;
    
    if (leaderName.toLowerCase() === state.username.toLowerCase()) {
        showToast('⚠️ No puedes unirte a tu propio clan.');
        return;
    }
    
    const requestConvId = 'req_' + Date.now();
    const newRequestConv = {
        id: requestConvId,
        listingId: factionId,
        buyer: state.username,
        seller: faction.publisher,
        status: 'pending',
        messages: [{
            sender: state.username,
            text: `¡Hola! Me gustaría unirme a tu clan ${faction.title}.`,
            time: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})
        }]
    };
    
    if (supabaseClient) {
        try {
            const { error } = await supabaseClient
                .from('conversations')
                .insert([{
                    id: newRequestConv.id,
                    listing_id: newRequestConv.listingId,
                    buyer: newRequestConv.buyer,
                    seller: newRequestConv.seller,
                    status: newRequestConv.status,
                    messages: newRequestConv.messages
                }]);
            if (error) throw error;
            showToast('✉️ Solicitud de unión enviada al líder.');
        } catch(err) {
            console.error("Error al enviar solicitud de unión:", err);
            showToast('❌ Error de conexión al enviar la solicitud.');
            return;
        }
    }
    
    state.conversations.push(newRequestConv);
    localStorage.setItem('obs_conversations', JSON.stringify(state.conversations));
    updateInboxBadge();
    
    closeModal('modal-view-faction');
    openInboxModal();
}

async function acceptFactionRequest(chatId) {
    const c = state.conversations.find(conv => conv.id === chatId);
    if (!c) return;
    
    const faction = state.marketplaceListings.find(l => l.id === c.listingId);
    if (!faction) {
        showToast('❌ No se encontró el clan.');
        return;
    }
    
    let factionData = {};
    try {
        if (faction.desc && faction.desc.startsWith('FACDATA:')) {
            factionData = JSON.parse(faction.desc.substring(8));
        }
    } catch(e) {}
    
    const currentCount = parseInt(factionData.memberCount || 1);
    const maxLimit = parseInt(factionData.maxMembers || 8);
    
    if (currentCount >= 8) {
        showToast('⚠️ El clan ya ha alcanzado el límite máximo de 8 miembros.');
        return;
    }
    
    factionData.memberCount = currentCount + 1;
    const newDesc = "FACDATA:" + JSON.stringify(factionData);
    
    if (supabaseClient) {
        try {
            const { error } = await supabaseClient
                .from('listings')
                .update({ desc_text: newDesc })
                .eq('id', faction.id);
            if (error) throw error;
        } catch(err) {
            console.error("Error al actualizar miembros del clan en Supabase:", err);
            showToast('❌ Error al actualizar los miembros en el servidor.');
            return;
        }
    }
    
    faction.desc = newDesc;
    localStorage.setItem('obs_market_listings', JSON.stringify(state.marketplaceListings));
    
    const acceptanceMsg = {
        sender: state.username,
        text: `🟢 ¡Solicitud Aceptada! Bienvenido al clan ${faction.title}.`,
        time: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})
    };
    const newMessages = [...c.messages, acceptanceMsg];
    
    if (supabaseClient) {
        try {
            const { error } = await supabaseClient
                .from('conversations')
                .update({ 
                    status: 'accepted',
                    messages: newMessages,
                    updated_at: new Date()
                })
                .eq('id', c.id);
            if (error) throw error;
        } catch(err) {
            console.error("Error al aceptar solicitud en Supabase:", err);
            showToast('❌ Error de conexión al guardar el chat.');
            return;
        }
    }
    
    c.status = 'accepted';
    c.messages = newMessages;
    localStorage.setItem('obs_conversations', JSON.stringify(state.conversations));
    
    showToast(`🟢 Has aceptado a ${c.buyer} en tu clan!`);
    
    renderChatMessages();
    renderInboxList();
    renderFactions();
}

async function rejectFactionRequest(chatId) {
    const c = state.conversations.find(conv => conv.id === chatId);
    if (!c) return;
    
    const rejectionMsg = {
        sender: state.username,
        text: `🔴 Solicitud Rechazada.`,
        time: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})
    };
    const newMessages = [...c.messages, rejectionMsg];
    
    if (supabaseClient) {
        try {
            const { error } = await supabaseClient
                .from('conversations')
                .update({ 
                    status: 'rejected',
                    messages: newMessages,
                    updated_at: new Date()
                })
                .eq('id', c.id);
            if (error) throw error;
        } catch(err) {
            console.error("Error al rechazar solicitud en Supabase:", err);
            showToast('❌ Error de conexión al guardar el chat.');
            return;
        }
    }
    
    c.status = 'rejected';
    c.messages = newMessages;
    localStorage.setItem('obs_conversations', JSON.stringify(state.conversations));
    
    showToast(`🔴 Has rechazado la solicitud de ${c.buyer}.`);
    
    renderChatMessages();
    renderInboxList();
}

// ─── USER PROFILE MODAL ───────────────────────────────────────
const FRAME_CATALOG = {
    'frame-obsidian':  { name: 'Marco Obsidian',     cssClass: 'frame-obsidian', desc: 'Exclusivo · Código OBSIDIANSMP' },
    'frame-iron':      { name: 'Hierro Forjado',     cssClass: 'frame-iron', desc: 'Marco de acero steampunk' },
    'frame-emerald':   { name: 'Esmeralda Celestial', cssClass: 'frame-emerald', desc: 'Marco de esmeralda mágica' },
    'frame-netherite': { name: 'Netherite Ígneo',    cssClass: 'frame-netherite', desc: 'Marco de lava volcánica' },
    'frame-netherstar':{ name: 'Estrella del Nether', cssClass: 'frame-netherstar', desc: 'Marco cósmico de estrella' },
    'frame-diamond':   { name: 'Diamante Divino',    cssClass: 'frame-diamond', desc: 'Marco de diamante celestial' }
};

function getAvatarFrameHTML(avatarSrc, frameId, options = {}) {
    const size = options.size || '90px';
    const alt = options.alt || 'Avatar';
    const extraWrapClass = options.extraWrapClass || '';
    const extraWrapStyle = options.extraWrapStyle || '';
    const onClick = options.onClick ? `onclick="${options.onClick}"` : '';

    if (!frameId || !FRAME_CATALOG[frameId]) {
        return `
            <div class="avatar-frame-wrap no-frame ${extraWrapClass}" ${onClick} style="width:${size}; height:${size}; ${extraWrapStyle}">
                <img src="${avatarSrc}" alt="${alt}" class="avatar-img-inner" onerror="this.src='img/shulker_void_3d.png'">
            </div>
        `;
    }

    const frameInfo = FRAME_CATALOG[frameId];
    const cssClass = frameInfo.cssClass || frameId;
    const isObsidian = (frameId === 'frame-obsidian');

    const svgObsidian = isObsidian ? `
        <svg class="obsidian-svg-frame" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">
            <defs>
                <linearGradient id="obsidianGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stop-color="#ffffff" />
                    <stop offset="25%" stop-color="#f0abfc" />
                    <stop offset="55%" stop-color="#c084fc" />
                    <stop offset="80%" stop-color="#9333ea" />
                    <stop offset="100%" stop-color="#4c1d95" />
                </linearGradient>
                <filter id="obsGlow" x="-30%" y="-30%" width="160%" height="160%">
                    <feGaussianBlur stdDeviation="2" result="blur" />
                    <feComposite in="SourceGraphic" in2="blur" operator="over" />
                </filter>
            </defs>
            <!-- Outer Octagon Magical Rune Ring -->
            <polygon points="50,3 83,17 97,50 83,83 50,97 17,83 3,50 17,17" fill="none" stroke="url(#obsidianGrad)" stroke-width="2.8" stroke-linejoin="round" filter="url(#obsGlow)"/>
            <!-- Inner Hexagon Accent Seal -->
            <polygon points="50,9 85,29 85,71 50,91 15,71 15,29" fill="none" stroke="#d8b4fe" stroke-width="1" stroke-dasharray="4 4" opacity="0.65" />
            <!-- 8 Glowing Crystal Diamonds at Vertices -->
            <polygon points="50,0 54,3 50,6 46,3" fill="#ffffff" filter="url(#obsGlow)" />
            <polygon points="83,14 86,17 83,20 80,17" fill="#f0abfc" filter="url(#obsGlow)" />
            <polygon points="97,47 100,50 97,53 94,50" fill="#ffffff" filter="url(#obsGlow)" />
            <polygon points="83,80 86,83 83,86 80,83" fill="#f0abfc" filter="url(#obsGlow)" />
            <polygon points="50,94 54,97 50,100 46,97" fill="#ffffff" filter="url(#obsGlow)" />
            <polygon points="17,80 20,83 17,86 14,83" fill="#f0abfc" filter="url(#obsGlow)" />
            <polygon points="3,47 6,50 3,53 0,50" fill="#ffffff" filter="url(#obsGlow)" />
            <polygon points="17,14 20,17 17,20 14,17" fill="#f0abfc" filter="url(#obsGlow)" />
            <!-- Ornate Corner Rune Flourishes -->
            <path d="M 45,6 Q 50,2 55,6" fill="none" stroke="#e9d5ff" stroke-width="1.2" />
            <path d="M 45,94 Q 50,98 55,94" fill="none" stroke="#e9d5ff" stroke-width="1.2" />
            <path d="M 6,45 Q 2,50 6,55" fill="none" stroke="#e9d5ff" stroke-width="1.2" />
            <path d="M 94,45 Q 98,50 94,55" fill="none" stroke="#e9d5ff" stroke-width="1.2" />
            <!-- Inner Dashed Rotating Magic Rune Ring -->
            <circle cx="50" cy="50" r="41" fill="none" stroke="#f4e8ff" stroke-width="1.4" stroke-dasharray="4 6" opacity="0.9" class="obsidian-svg-dashed"/>
        </svg>
    ` : '';

    return `
        <div class="avatar-frame-wrap ${cssClass} ${extraWrapClass}" ${onClick} style="width:${size}; height:${size}; ${extraWrapStyle}">
            <div class="steam-glow"></div>
            <div class="steam-ring"></div>
            ${svgObsidian}
            <div class="steam-particles">
                <span></span><span></span><span></span>
            </div>
            <img src="${avatarSrc}" alt="${alt}" class="avatar-img-inner" onerror="this.src='img/shulker_void_3d.png'">
        </div>
    `;
}

function switchProfileTab(tabName) {
    const tabs = ['marcos', 'cuenta', 'estilo'];
    tabs.forEach(t => {
        const btn = document.getElementById(`prf-tab-${t}`);
        const panel = document.getElementById(`prf-panel-${t}`);
        const isActive = (t === tabName);
        if (btn) btn.classList.toggle('active', isActive);
        if (panel) panel.style.display = isActive ? 'block' : 'none';
    });
}

function openUserProfileModal(targetUsername) {
    const isOwnProfile = (targetUsername === state.username);

    // Header
    const usernameEl = document.getElementById('prf-username-display');
    const tagEl = document.getElementById('prf-tag-display');
    const editPanel = document.getElementById('prf-edit-panel');
    const viewPanel = document.getElementById('prf-view-panel');
    const navTabs = document.getElementById('prf-nav-tabs');
    if (usernameEl) usernameEl.textContent = targetUsername;

    if (isOwnProfile) {
        if (tagEl) {
            tagEl.textContent = state.discordTag ? `@${state.discordTag}` : (state.discordId ? 'Discord conectado' : 'Sin Discord');
        }
        if (editPanel) editPanel.style.display = '';
        if (viewPanel) viewPanel.style.display = 'none';
        if (navTabs) navTabs.style.display = 'flex';

        // Set default tab to 'marcos'
        switchProfileTab('marcos');

        // Set avatar source radios
        const radios = document.querySelectorAll('input[name="avatar-source"]');
        radios.forEach(r => { r.checked = (r.value === (state.avatarSource || 'discord')); });

        // Show/hide custom upload
        const uploadWrap = document.getElementById('prf-custom-upload-wrap');
        if (uploadWrap) uploadWrap.style.display = (state.avatarSource === 'custom') ? 'flex' : 'none';

        // Frames gallery
        renderProfileFramesGallery();

        // Font buttons active state
        document.querySelectorAll('.prf-font-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.font === (state.profileFont || 'Outfit'));
        });
    } else {
        if (editPanel) editPanel.style.display = 'none';
        if (navTabs) navTabs.style.display = 'none';
        if (viewPanel) viewPanel.style.display = '';
        const viewMsg = document.getElementById('prf-view-msg');
        if (viewMsg) viewMsg.textContent = `Perfil de ${targetUsername}`;
        if (tagEl) tagEl.textContent = '';
    }

    // Render avatar preview in header
    renderProfileAvatarPreview(targetUsername, isOwnProfile);

    openModal('modal-user-profile');
}

function renderProfileAvatarPreview(username, isOwnProfile) {
    const wrap = document.getElementById('prf-avatar-wrap');
    if (!wrap) return;

    let avatarSrc;
    if (isOwnProfile) {
        if (state.avatarSource === 'custom' && state.customAvatar) {
            avatarSrc = state.customAvatar;
        } else if (state.avatarSource === 'discord' && state.discordId) {
            avatarSrc = state.discordUser?.avatar
                ? `https://cdn.discordapp.com/avatars/${state.discordId}/${state.discordUser.avatar}.png`
                : `https://cdn.discordapp.com/embed/avatars/0.png`;
        } else {
            avatarSrc = `https://mc-heads.net/avatar/${encodeURIComponent(username || 'Steve')}/80`;
        }
    } else {
        avatarSrc = `https://mc-heads.net/avatar/${encodeURIComponent(username || 'Steve')}/80`;
    }

    const frameId = isOwnProfile ? state.activeFrame : '';
    wrap.innerHTML = getAvatarFrameHTML(avatarSrc, frameId, {
        size: '90px',
        alt: username
    });
}

function updateProfileAvatarPreview(source) {
    state.avatarSource = source;
    localStorage.setItem('obs_avatar_source', source);
    const uploadWrap = document.getElementById('prf-custom-upload-wrap');
    if (uploadWrap) uploadWrap.style.display = (source === 'custom') ? 'flex' : 'none';
    renderProfileAvatarPreview(state.username, true);
    syncUser();
    renderMarketListings();
    showToast('🖼️ Foto de perfil guardada');
}

function onProfileImageUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
        showToast('⚠️ La imagen no debe superar los 2 MB.');
        return;
    }
    const nameEl = document.getElementById('prf-file-name');
    if (nameEl) nameEl.textContent = file.name;

    const reader = new FileReader();
    reader.onload = (e) => {
        state.customAvatar = e.target.result;
        state.avatarSource = 'custom';
        localStorage.setItem('obs_custom_avatar', state.customAvatar);
        localStorage.setItem('obs_avatar_source', 'custom');
        const radios = document.querySelectorAll('input[name="avatar-source"]');
        radios.forEach(r => { r.checked = (r.value === 'custom'); });
        renderProfileAvatarPreview(state.username, true);
        syncUser();
        renderMarketListings();
        showToast('🖼️ Foto personalizada guardada');
    };
    reader.readAsDataURL(file);
}

function renderProfileFramesGallery() {
    const gallery = document.getElementById('prf-frames-gallery');
    if (!gallery) return;

    if (!state.unlockedFrames || state.unlockedFrames.length === 0) {
        gallery.innerHTML = `<span class="prf-no-frames">Sin marcos desbloqueados aún. <strong>¡Canjea el código OBSIDIANSMP en el Marketplace!</strong></span>`;
        return;
    }

    gallery.innerHTML = state.unlockedFrames.map(fId => {
        const info = FRAME_CATALOG[fId] || { name: fId, desc: '' };
        const isActive = state.activeFrame === fId;
        const preview = getAvatarFrameHTML('https://mc-heads.net/avatar/MHF_Steve/40', fId, { size: '42px', alt: info.name });
        return `
            <div class="prf-frame-opt ${isActive ? 'active' : ''}" onclick="equipFrame('${fId}')">
                ${preview}
                <span>${info.name}</span>
                ${isActive ? '<i class="fa-solid fa-check-circle prf-equip-check"></i>' : ''}
            </div>
        `;
    }).join('');
}

function equipFrame(frameId) {
    state.activeFrame = (state.activeFrame === frameId) ? '' : frameId;
    saveUserDataToStorage();
    renderProfileFramesGallery();
    renderProfileAvatarPreview(state.username, true);
    syncUser();
    renderMarketListings();
    const frameName = FRAME_CATALOG[frameId]?.name || 'Marco';
    showToast(state.activeFrame ? `✨ ${frameName} equipado` : 'ℹ️ Marco desequipado');
}

function applyProfileFont(fontName) {
    state.profileFont = fontName;
    localStorage.setItem('obs_profile_font', fontName);
    document.body.style.fontFamily = `'${fontName}', sans-serif`;
    document.querySelectorAll('.prf-font-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.font === fontName);
    });
    showToast(`🔤 Tipografía guardada: ${fontName}`);
}

// Apply saved font on page load
(function initProfileSettings() {
    const savedFont = localStorage.getItem('obs_profile_font');
    if (savedFont && savedFont !== 'Outfit') {
        document.body.style.fontFamily = `'${savedFont}', sans-serif`;
    }
})();

// ─── LIVE MARKET TICKER SYSTEM ──────────────────────────────────
const INITIAL_MARKET_ACTIVITIES = [
    { text: '<strong>pablitorey_</strong> publicó Pechera de Netherite Ígnea', icon: 'fa-solid fa-fire', color: '#f97316' },
    { text: '<strong>mootz</strong> compró Kit Shulker Vorágine', icon: 'fa-solid fa-gem', color: '#38bdf8' },
    { text: '<strong>Steve</strong> intercambió 64 Bloques de Obsidiana', icon: 'fa-solid fa-box', color: '#a855f7' },
    { text: '<strong>elpayasowtf123</strong> equipó el Marco Obsidian Místico', icon: 'fa-solid fa-shield-halved', color: '#c084fc' }
];

let marketActivities = [...INITIAL_MARKET_ACTIVITIES];

function pushMarketActivity(text, iconClass = 'fa-solid fa-store', color = '#a855f7') {
    marketActivities.unshift({ text, icon: iconClass, color });
    if (marketActivities.length > 10) marketActivities.pop();
    renderMarketTicker();
}

function renderMarketTicker() {
    const tickerEl = document.getElementById('market-live-ticker');
    if (!tickerEl) return;

    tickerEl.innerHTML = marketActivities.map(act => `
        <div class="ticker-item">
            <i class="${act.icon}" style="color:${act.color};"></i>
            <span>${act.text}</span>
        </div>
    `).join('');
}

// Auto simulate market activity periodically
(function initMarketTickerAuto() {
    setInterval(() => {
        const randomItems = ['Espada de Netherite', 'Manzana de Oro', 'Elitros Encantados', 'Tótem de la Inmortalidad', 'Libro de Reparación', 'Palo de Blaze'];
        const randomUsers = ['Alex_MC', 'DragonSlayer', 'MinerPro99', 'ShadowKits', 'VortexPlayer'];
        const item = randomItems[Math.floor(Math.random() * randomItems.length)];
        const user = randomUsers[Math.floor(Math.random() * randomUsers.length)];
        pushMarketActivity(`<strong>${user}</strong> compró ${item}`, 'fa-solid fa-cart-shopping', '#4ade80');
    }, 15000);
})();

// ─── DAILY RUNE ROULETTE SYSTEM (SECURE ANTI-CHEAT) ────────────
const ROULETTE_PRIZES = [
    { name: '10 Gemas', points: 10 },
    { name: '15 Gemas', points: 15 },
    { name: '50 Gemas', points: 50 },
    { name: '25 Gemas', points: 25 },
    { name: '5 Gemas', points: 5 },
    { name: '75 Gemas', points: 75 },
    { name: '150 GEMAS (JACKPOT)', points: 150 },
    { name: '20 Gemas', points: 20 }
];

let isSpinning = false;
let currentRotation = 0;
let verifiedServerTimeOffset = 0;

async function syncVerifiedServerTime() {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2500);
        const res = await fetch('https://worldtimeapi.org/api/timezone/Etc/UTC', { signal: controller.signal });
        clearTimeout(timeoutId);
        if (res.ok) {
            const data = await res.json();
            if (data && data.unixtime) {
                const trueServerMs = data.unixtime * 1000;
                verifiedServerTimeOffset = trueServerMs - Date.now();
                return;
            }
        }
    } catch (e) {}

    try {
        const res = await fetch(window.location.href, { method: 'HEAD', cache: 'no-store' });
        const dateHeader = res.headers.get('date');
        if (dateHeader) {
            const trueServerMs = new Date(dateHeader).getTime();
            verifiedServerTimeOffset = trueServerMs - Date.now();
        }
    } catch (e) {}
}

function getSecureTime() {
    return Date.now() + verifiedServerTimeOffset;
}

let lastTimerText = '';
function checkRouletteCooldown() {
    const lastSpin = parseInt(localStorage.getItem('obs_last_spin_time') || '0');
    const now = getSecureTime();
    const cooldown = 24 * 60 * 60 * 1000;

    const timerEl = document.getElementById('roulette-countdown-text');
    const spinBtn = document.getElementById('spin-roulette-btn');

    // Anti-cheat detection: if last spin timestamp is far in the future compared to real UTC server time
    if (lastSpin > now + 300000) {
        if (timerEl) timerEl.textContent = '🚫 Manipulación de reloj detectada';
        if (spinBtn) {
            spinBtn.disabled = true;
            spinBtn.innerHTML = '<i class="fa-solid fa-ban"></i> HORA INCORRECTA';
        }
        return false;
    }

    const diff = now - lastSpin;

    if (diff >= cooldown) {
        if (timerEl && timerEl.textContent !== '¡Giro disponible!') {
            timerEl.textContent = '¡Giro disponible!';
        }
        if (spinBtn && spinBtn.disabled && !isSpinning) {
            spinBtn.disabled = false;
            spinBtn.innerHTML = '<i class="fa-solid fa-rotate-right"></i> ¡GIRAR RULETA AHORA!';
        }
        return true;
    } else {
        const remaining = cooldown - diff;
        const hours = Math.floor(remaining / (1000 * 60 * 60));
        const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((remaining % (1000 * 60)) / 1000);
        const text = `Próximo giro en ${hours}h ${minutes}m ${seconds}s`;
        if (timerEl && lastTimerText !== text) {
            timerEl.textContent = text;
            lastTimerText = text;
        }
        if (spinBtn && !spinBtn.disabled) {
            spinBtn.disabled = true;
            spinBtn.innerHTML = `<i class="fa-solid fa-lock"></i> Disponible en ${hours}h ${minutes}m`;
        }
        return false;
    }
}

function spinDailyRoulette() {
    if (isSpinning) return;

    if (!checkRouletteCooldown()) {
        showToast('⏳ Ya giraste la ruleta hoy o la hora no está sincronizada.');
        return;
    }

    isSpinning = true;
    const wheel = document.getElementById('roulette-wheel');
    const spinBtn = document.getElementById('spin-roulette-btn');
    const resultBox = document.getElementById('roulette-prize-result');
    if (resultBox) resultBox.style.display = 'none';

    if (spinBtn) spinBtn.disabled = true;

    // Pick random prize index (0 to 7)
    const prizeIndex = Math.floor(Math.random() * ROULETTE_PRIZES.length);
    const prize = ROULETTE_PRIZES[prizeIndex];

    const degreesPerSeg = 45;
    const targetDegree = 360 - (prizeIndex * degreesPerSeg + degreesPerSeg / 2);
    const extraSpins = 6 * 360;
    currentRotation += extraSpins + (targetDegree - (currentRotation % 360));

    if (wheel) {
        wheel.style.transform = `rotate(${currentRotation}deg)`;
    }

    // Play tick sounds while wheel spins
    let tickCount = 0;
    const maxTicks = 18;
    const tickInterval = setInterval(() => {
        tickCount++;
        playMcClick();
        if (tickCount >= maxTicks) clearInterval(tickInterval);
    }, 220);

    setTimeout(async () => {
        isSpinning = false;
        const secureNow = getSecureTime();
        localStorage.setItem('obs_last_spin_time', secureNow.toString());

        // Grant REAL gems to state, localStorage and database
        const amount = prize.points;
        saveUserPoints((state.points || 0) + amount);

        // Sound & Confetti Explosions!
        playVictoryFanfare();
        triggerConfetti();

        if (resultBox) {
            resultBox.innerHTML = `
                <div style="font-size: 1.1rem; color: #fef08a; margin-bottom: 4px; text-shadow: 0 0 10px rgba(254,240,138,0.5);">🎉 ¡ENHORABUENA!</div>
                <div style="font-size: 1.35rem; color: #4ade80; font-weight: 800; text-shadow: 0 0 12px rgba(74,222,128,0.5);">+${amount} GEMAS AÑADIDAS</div>
                <div style="font-size: 0.8rem; color: #e2e8f0; margin-top: 4px;">Tu saldo actual es de <strong>${state.points} Gemas</strong></div>
            `;
            resultBox.style.display = 'block';
        }

        showToast(`🎉 ¡+${amount} Gemas acreditadas! Saldo: ${state.points} Gemas.`);

        const user = state.username || 'Invitado';
        pushMarketActivity(`<strong>${user}</strong> giró la Ruleta Diaria y ganó <strong>+${amount} Gemas</strong>`, 'fa-solid fa-gem', '#eab308');

        checkRouletteCooldown();
    }, 4600);
}

// Init ticker & cooldown timer interval
(function initRouletteAndTicker() {
    setTimeout(async () => {
        await syncVerifiedServerTime();
        renderMarketTicker();
        checkRouletteCooldown();
        setInterval(checkRouletteCooldown, 1000);
    }, 500);
})();
