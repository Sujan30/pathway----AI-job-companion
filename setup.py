import asyncio, os
from hydra_db import AsyncHydraDB
from dotenv import load_dotenv

load_dotenv()

hydra_key = os.getenv("HYDRA_DB_API_KEY")


async def setup():
    client = AsyncHydraDB(token=hydra_key)
    await client.tenants.create(tenant_id="pilot")
    print("done")

asyncio.run(setup())