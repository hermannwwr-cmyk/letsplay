# Setting up the family room on Cloudflare (about 10 minutes, free)

The family room in Little Bus Captain needs a tiny "room keeper" program on the internet. It only passes
bus positions, colours, numbers and honks between the devices in a room. No names, nothing saved.

## 1. Make a free account
1. Go to https://dash.cloudflare.com/sign-up and sign up (the Free plan is enough).
2. Confirm your email.

## 2. Create the program
1. In the Cloudflare dashboard, open **Compute (Workers)** → **Workers & Pages** in the left menu.
2. Click **Create** → **Create Worker** (start from "Hello World").
3. Name it exactly: `bus-captain-rooms`, then click **Deploy**.
4. Click **Edit code**. Delete everything in the editor, then paste the whole contents of `worker.js`
   (from this folder). Click **Deploy**.

## 3. Give it its "rooms"
1. Go back to the Worker (`bus-captain-rooms`) → **Settings** → **Bindings** → **Add binding**.
2. Choose **Durable Object**.
3. Variable name: `ROOMS`. Durable Object class: choose `Room` (from this Worker). Save / Deploy.

## 4. Check it
1. On the Worker's page, copy its address. It looks like `https://bus-captain-rooms.YOUR-NAME.workers.dev`.
2. Open that address with `/health` added at the end. It should say `ok`.
3. Send that address to Claude (it isn't a secret). Claude puts it in the game.

If step 3 doesn't offer the `Room` class or shows an error, tell Claude what the screen says.
