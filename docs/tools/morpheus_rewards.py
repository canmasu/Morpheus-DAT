"""Per-pool MOR distribution on Morpheus Capital (Ethereum mainnet), from on-chain history.

For the last 7 and 30 days: MOR credited to each deposit pool (Distributor.distributedRewards), its share,
deposits, virtual deposits (deposit x power factor) and what a 1x deposit earned (DepositPool rate change).
See docs/morpheus-economics.md. Needs Foundry's `cast` and an archive-capable RPC.

    python3 docs/tools/morpheus_rewards.py [rpc-url]
"""
import subprocess
import sys

RPC = sys.argv[1] if len(sys.argv) > 1 else "https://eth.drpc.org"
REWARD_POOL = "0xb7994dE339AEe515C9b2792831CD83f3C9D8df87"
DISTRIBUTOR = "0xDf1AC1AC255d91F5f4B1E3B4Aef57c5350F64C7A"
POOLS = {
    "stETH": ("0x47176B2Af9885dC6C4575d4eFd63895f7Aaa4790", 18),
    "USDC": ("0x6cCE082851Add4c535352f596662521B4De4750E", 6),
    "USDT": ("0x3B51989212BEdaB926794D6bf8e9E991218cf116", 6),
    "WBTC": ("0xdE283F8309Fd1AA46c95d299f6B8310716277A42", 8),
    "WETH": ("0x9380d72aBbD6e0Cc45095A2Ef8c2CA87d77Cb384", 18),
}
BLOCKS_PER_DAY = 7200


def cast(*args):
    out = subprocess.run(["cast", *args, "--rpc-url", RPC], capture_output=True, text=True, check=True).stdout
    return out.strip().split("\n")


def call(to, sig, *args, block=None):
    extra = ["--block", str(block)] if block else []
    return [int(line.split()[0]) for line in cast("call", to, sig, *map(str, args), *extra)]


def timestamp(block):
    return int(cast("block", str(block), "-f", "timestamp")[0])


def main():
    now = int(cast("block-number")[0])
    t_now = timestamp(now)
    print(f"block {now}")
    for days in (7, 30):
        past = now - days * BLOCKS_PER_DAY
        t_past = timestamp(past)
        span = (t_now - t_past) / 86400
        emitted = call(REWARD_POOL, "getPeriodRewards(uint256,uint128,uint128)(uint256)", 0, t_past, t_now)[0] / 1e18
        print(f"\nlast {days} days ({span:.2f} d): Capital emission {emitted / span:,.1f} MOR/day")
        rows = []
        for name, (pool, dec) in POOLS.items():
            dist = "distributedRewards(uint256,address)(uint256)"
            mor = (call(DISTRIBUTOR, dist, 0, pool)[0] - call(DISTRIBUTOR, dist, 0, pool, block=past)[0]) / 1e18 / span
            rate_now = call(pool, "rewardPoolsData(uint256)(uint128,uint256,uint256)", 0)
            rate_past = call(pool, "rewardPoolsData(uint256)(uint128,uint256,uint256)", 0, block=past)
            deposited = call(pool, "totalDepositedInPublicPools()(uint256)")[0] / 10**dec
            virtual = rate_now[2] / 10**dec
            # rate: cumulative MOR (18 decimals) per virtual token unit, scaled by 1e25
            elapsed_days = (rate_now[0] - rate_past[0]) / 86400
            per_token = (rate_now[1] - rate_past[1]) / 1e25 * 10**dec / 1e18 / elapsed_days if elapsed_days else 0.0
            rows.append((name, mor, deposited, virtual, per_token))
        total = sum(r[1] for r in rows) or 1
        for name, mor, deposited, virtual, per_token in rows:
            avg = virtual / deposited if deposited else 0
            print(
                f"  {name:6} {mor:9.2f} MOR/day ({mor / total:6.2%}) | deposited {deposited:,.4f} | "
                f"virtual {virtual:,.4f} (avg x{avg:.2f}) | 1x earned {per_token:.6f} MOR/token/day"
            )


if __name__ == "__main__":
    main()
