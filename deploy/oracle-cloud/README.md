# Free-tier deployment on Oracle Cloud

This deployment runs the React client and FastAPI API in one container on an
Oracle Cloud Infrastructure (OCI) VM. Caddy provides HTTPS. SQLite and uploaded
profile images use persistent Docker volumes.

OCI free capacity and eligibility are not guaranteed. Create only resources
marked **Always Free**, and check the current terms and region availability
before provisioning. The app is not production-ready for a college-wide
deployment with sensitive student records until backups, access controls,
monitoring, and a managed PostgreSQL database are in place.

## 1. Create the OCI VM

In the OCI Console, create an Ubuntu 24.04 VM using an Ampere A1 shape and only
the Always Free allocation. Assign it a public IPv4 address. If your region has
no free capacity, try another nearby region. Keep SSH access restricted to your
own public IP.

Create a DNS A record for a domain you control that points to the VM's public
IPv4 address. A domain is needed for Caddy to obtain a browser-trusted HTTPS
certificate; the domain itself may not be free.

In OCI's network security rules and on the VM firewall, allow inbound TCP 80
and 443. Do not expose port 8000 to the public internet. Keep SSH (port 22)
restricted to your own IP.

## 2. Install Docker and transfer the project

SSH into the VM, install Docker Engine and the Docker Compose plugin using
[Docker's official Ubuntu instructions](https://docs.docker.com/engine/install/ubuntu/),
then transfer or clone this repository to the VM. Include the deployment files
in this checkout. Local changes that have not been pushed to the repository
must also be copied; do not copy any local `.env` files.

## 3. Configure and start SMARTGATE

From the project root on the VM:

```sh
cp deploy/oracle-cloud/.env.example deploy/oracle-cloud/.env
```

Edit `deploy/oracle-cloud/.env`: set `SMARTGATE_DOMAIN` to the DNS name pointed
at the VM, set the same HTTPS origin in `CORS_ORIGINS`, and set the matching
exact-origin regular expression in `CORS_ORIGIN_REGEX`. Generate a unique
`JWT_SECRET` of at least 32 characters:

```sh
openssl rand -base64 48
```

Do not use the example placeholder, commit `.env`, or share the generated
secret. Review OCI firewall rules before starting:

```sh
docker compose --env-file deploy/oracle-cloud/.env \
  -f deploy/oracle-cloud/compose.yaml up -d --build
```

The app runs database migrations at startup. After DNS has propagated, visit
`https://<your-domain>/` and check `https://<your-domain>/health`.

## 4. Set up accounts and backups

Create the first administrator interactively; do not seed the local demo
accounts on a public server:

```sh
docker compose --env-file deploy/oracle-cloud/.env \
  -f deploy/oracle-cloud/compose.yaml exec smartgate python -m app.bootstrap_admin
```

Never deploy the repository's local database, `.env` files, or demo credentials.
Back up the `smartgate_data` and `smartgate_uploads` Docker volumes to storage
outside the VM and test restoring them. A free-tier VM is best treated as a demo
or pilot: it can be reclaimed, unavailable, or suspended under the provider's
free-tier policy.

The offline security-verification feature is not configured by this default
deployment. Enable it only after securely provisioning its dedicated RSA
private key on the server and building the frontend with its matching public
key. Never put the private key in the repository or the frontend build.
