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
            .select('*')
            .or(`buyer.eq.${state.username},seller.eq.${state.username}`)
            .order('updated_at', { ascending: false });
        if (error) throw error;
        if (data) {
            state.conversations = data.map(c => ({
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
    conversations: JSON.parse(localStorage.getItem('obs_conversations') || '[]')
};

function parsePublisher(pubStr) {
    if (!pubStr) return { username: 'Invitado', discordId: null, avatar: null };
    if (pubStr.includes('|')) {
        const parts = pubStr.split('|');
        return { username: parts[0], discordId: parts[1] || null, avatar: parts[2] || null };
    }
    return { username: pubStr, discordId: null, avatar: null };
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
            state.points = parseInt(localStorage.getItem(`obs_points_${user.id}`) || '0', 10);
            
            if (state.username) {
                syncUser();
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
    localStorage.removeItem("obs_discord_token");
    state.username = '';
    state.discordUser = null;
    state.discordId = null;
    state.discordTag = null;
    state.points = 0;
    
    syncUser();
    showToast("🚪 Sesión cerrada correctamente.");
    
    const authView = document.getElementById('discord-auth-view');
    const linkView = document.getElementById('minecraft-link-view');
    const profileView = document.getElementById('profile-settings-view');
    if (authView) authView.style.display = 'block';
    if (linkView) linkView.style.display = 'none';
    if (profileView) profileView.style.display = 'none';
    
    openModal('modal-login');
}

async function unlinkAccount() {
    if (!state.discordId || !state.username) return;
    
    closeModal('modal-login'); // Close profile modal first so the confirmation modal is clear
    
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

function updateSettingsUI() {
    const soundBtn = document.getElementById('setting-sound-btn');
    const particlesBtn = document.getElementById('setting-particles-btn');
    
    const soundOn = localStorage.getItem('mc_sound') !== 'false';
    const particlesOn = localStorage.getItem('mc_particles') !== 'false';
    
    if (soundBtn) {
        soundBtn.textContent = soundOn ? 'Sí' : 'No';
        soundBtn.classList.toggle('yes', soundOn);
    }
    if (particlesBtn) {
        particlesBtn.textContent = particlesOn ? 'Sí' : 'No';
        particlesBtn.classList.toggle('yes', particlesOn);
    }
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
        });
        dbFetchConversations().then(() => {
            updateInboxBadge();
        });
    } else {
        setTimeout(() => {
            if (state.activeMarketCategory) renderMarketplace();
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

    window.addEventListener('resize', () => {
        W = canvas.width = window.innerWidth;
        H = canvas.height = window.innerHeight;
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
    const validTabs = ['inicio', 'reglas', 'quienes', 'kits', 'puntos', 'marketplace'];
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

    const navBar = document.getElementById('main-nav-bar');
    if (navBar && tabId !== 'inicio') {
        const topPos = navBar.getBoundingClientRect().top + window.pageYOffset - 80;
        window.scrollTo({ top: Math.max(0, topPos), behavior: 'smooth' });
    } else {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

// ─── USER & POINTS ─────────────────────────────────────────────
function syncUser() {
    const u = state.username || 'Invitado';
    const navName = document.getElementById('nav-username');
    const navSkin = document.getElementById('nav-skin-img');
    const navStatus = document.getElementById('nav-cart-status');
    const ownerSkin = document.getElementById('owner-skin-img');
    if (navName) navName.textContent = u;
    if (navSkin) {
        if (state.discordId) {
            if (state.discordUser && state.discordUser.avatar) {
                navSkin.src = `https://cdn.discordapp.com/avatars/${state.discordId}/${state.discordUser.avatar}.png`;
            } else {
                navSkin.src = `https://cdn.discordapp.com/embed/avatars/0.png`;
            }
        } else {
            navSkin.src = `https://mc-heads.net/avatar/${encodeURIComponent(u)}/40`;
        }
    }
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
    if (modalPts) modalPts.textContent = state.points;

    // Cart status color
    const total = cartTotal();
    const qty = cartQty();
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
                                desc.innerHTML = '⚠️ Este usuario de Minecraft ya está registrado. <strong style="color: var(--primary);">Ingresa tu contraseña de seguridad de 2 pasos</strong> para enlazarlo.';
                            } else {
                                desc.innerHTML = '✨ El usuario está disponible. <strong style="color: #4ade80;">Crea una contraseña de seguridad de 2 pasos</strong> para proteger tu cuenta.';
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
    const v = inp?.value.trim();
    const enteredPass = passInp?.value.trim();
    
    if (!v) { showToast('⚠️ Ingresa tu usuario de Minecraft.'); return; }
    if (v.includes(' ') || v.includes('|')) { showToast('⚠️ Nombre de usuario no válido.'); return; }
    if (!enteredPass) { showToast('⚠️ Ingresa tu contraseña de seguridad de 2 pasos.'); return; }
    
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
                
                if (enteredPass !== storedPass) {
                    showToast('❌ Contraseña de seguridad de 2 pasos incorrecta.');
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
                const { error: insError } = await supabaseClient
                    .from('conversations')
                    .insert([{
                        id: 'reg_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
                        listing_id: 'registration',
                        buyer: v.toLowerCase(),
                        seller: state.discordId,
                        status: 'active',
                        messages: ["pass:" + enteredPass]
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
    
    syncUser();
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
        const profileView = document.getElementById('profile-settings-view');
        
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

// ─── OBSIDIAN GEMAS REWARDS ───────────────────────────────────
function redeemReward(rewardId, gemasCost, rewardName) {
    if (state.points < gemasCost) {
        showToast(`⚠️ No tienes suficientes Gemas. Necesitas ${gemasCost} Gemas (tienes ${state.points} Gemas).`);
        return;
    }
    state.points -= gemasCost;
    localStorage.setItem('obs_points', state.points);
    syncUser();
    showToast(`🎉 ¡Canjeado con éxito! "${rewardName}" ha sido acreditado a tu cuenta de Minecraft.`);
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
        const matchesCat = (cat === 'all' || item.category === cat);
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

        const isOwner = pubInfo.discordId 
            ? (pubInfo.discordId === state.discordId)
            : (pubInfo.username === state.username);

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
                            <img src="${pubSkin}" alt="${pubInfo.username}" class="mc-user-avatar">
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

    const isOwner = pubInfo.discordId 
        ? (pubInfo.discordId === state.discordId)
        : (pubInfo.username === state.username);

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
    } else {
        state.conversations.push(newConv);
        localStorage.setItem('obs_conversations', JSON.stringify(state.conversations));
        updateInboxBadge();
    }
    
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

    if (c.status === 'pending' && c.buyer === state.username) {
        inputArea.style.display = 'none';
        msgsBox.innerHTML += `<div style="text-align:center; color:var(--text-muted); font-size:0.85rem; margin-top:1rem;">Esperando a que el vendedor responda...</div>`;
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

    if (supabaseClient) {
        const newMessages = [...c.messages, {
            sender: state.username,
            text,
            time: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})
        }];
        const newStatus = (c.status === 'pending' && c.seller === state.username) ? 'active' : c.status;
        
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
    } else {
        if (c.status === 'pending' && c.seller === state.username) {
            c.status = 'active';
        }
        c.messages.push({
            sender: state.username,
            text,
            time: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})
        });
        localStorage.setItem('obs_conversations', JSON.stringify(state.conversations));
        
        if (currentInboxTab === 'pending' && c.status === 'active') {
            activeChatId = c.id; 
            setInboxTab('active');
        } else {
            renderInboxList();
            renderChatMessages();
        }
        updateInboxBadge();
    }

    inp.value = '';
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
        const isOwner = pubInfo.discordId 
            ? (pubInfo.discordId === state.discordId)
            : (pubInfo.username === state.username);
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
