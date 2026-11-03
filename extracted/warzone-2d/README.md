# WARZONE 2D — Tactical Arena

Game perang 2D top-down berbasis browser. Bisa langsung dimainkan melawan bot setelah `npm install` dan `npm run dev`. Deploy ke Vercel sebagai Vite app.

## Fitur
- Team Deathmatch, Zone Control (mode arena), Survival vs Bots
- 3 class: Assault, Scout, Heavy
- Bot dengan AI sederhana, tembakan, respawn, HP dan ammo
- Grenade cooldown, medkit, speed pickup
- Minimap, kill feed, skor tim, leaderboard, timer
- Kontrol keyboard/mouse dan tombol sentuh untuk HP
- Online room menggunakan Supabase Realtime Broadcast + Presence (perlu konfigurasi project)

## Jalankan lokal
```bash
npm install
npm run dev
```
Buka URL yang muncul dari Vite.

## Deploy ke GitHub + Vercel
1. Upload seluruh isi folder ini ke repository GitHub.
2. Di Vercel pilih **Add New → Project**, import repository.
3. Framework: Vite. Build command: `npm run build`. Output directory: `dist`.
4. Deploy. Tidak perlu backend untuk mode latihan.

## Aktifkan multiplayer online
Multiplayer menggunakan Supabase Realtime. Buat project gratis di Supabase, lalu buka **Project Settings → API**.
1. Salin Project URL dan `anon/public` key.
2. Isi `src/config.js`:
```js
export const SUPABASE_URL = "https://PROJECT_ID.supabase.co";
export const SUPABASE_ANON_KEY = "SUPABASE_ANON_PUBLIC_KEY";
export const MAX_PLAYERS = 8;
```
3. Commit perubahan ke GitHub; Vercel akan deploy ulang otomatis.
4. Buat room atau masukkan kode room yang sama dari perangkat lain.

### Catatan multiplayer V1
- Presence dipakai untuk daftar pemain dan posisi.
- Broadcast dipakai untuk event tembakan dan kill feed.
- Ini fondasi multiplayer real-time ringan, bukan server authoritative. Posisi dan hit detection masih diproses di browser masing-masing; jangan gunakan untuk kompetisi berhadiah atau ranked serius.
- Jangan pernah memasukkan `service_role` key ke frontend. Gunakan hanya anon/public key.
- Jika project Supabase membatasi Realtime, aktifkan Realtime pada project settings.

## Struktur
```text
warzone-2d/
├── index.html
├── package.json
├── public/
│   └── style.css
├── src/
│   ├── config.js
│   └── main.js
└── README.md
```
