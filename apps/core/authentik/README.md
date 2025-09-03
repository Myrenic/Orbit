# ⚡ Orbit | Authentik Application Control ⚡

## Step 0: Change default admin password👤

Make sure your authentik pod is ready:  

1. Go to **https://auth.ingress.tuntelder.com/if/flow/initial-setup/**.  
2. Fill in the form

## Step 1: Check Your Outpost 🖥️

Make sure your embedded outpost is online and ready:  

1. Go to **Outpost Integration**.  
2. Confirm **Authentik Embedded Outpost** is present.  
3. If missing, add it to bring it online.  

---

## Step 2: Create Your Proxy Provider 🔗

Your provider is the gateway to the grid.  

1. Navigate to **Provider → Create Provider**.  
2. Select **Proxy Provider**.  
3. Fill in the fields:

- **Name:** encom-tower  
- **Auth Flow:** explicit or implicit
- **Use Domain Level Forwarding**  
- **Auth URL:** `https://auth.ingress.tuntelder.com/`  
- **Cookie Domain:** `.ingress.tuntelder.com`  

---

## Step 3: Create Your Application 🛠️

Plug your app into the grid:  

1. Go to **Applications → Create App**.  
2. Fill in the fields:

- **Name:** encom-tower    
- **Provider:** Select the provider created above  

---

## Step 4: Sync with the Outpost 🌐

Connect your app to the outpost for full control:  

1. Go to **Outpost → Authentik Embedded Outpost → Edit**.  
2. Move your new app from the **left box** to the **right box**.  
3. Select **Local Kubernetes Cluster** inside the **intergration** pull-down.
4. Your app is now live on the grid.  

---

## ⚡ Notes

Think of providers as gateways, applications as programs, and the outpost as the hub connecting everything. 

The grid will hum in harmony.
