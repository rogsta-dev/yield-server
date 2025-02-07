const controllerAbi = require('./abis/conic-controller-abi.json');
const poolAbi = require('./abis/conic-pool-abi.json');
const erc20Abi = require('./abis/conic-erc20-abi.json');
const inflationManagerAbi = require('./abis/conic-inflation-manager-abi.json');
const { getProvider } = require('@defillama/sdk/build/general');
const { Contract, BigNumber } = require('ethers');
const provider = getProvider('ethereum');

const CONTROLLER = '0x013A3Da6591d3427F164862793ab4e388F9B587e';
const INFLATION_MANAGER = '0xf4A364d6B513158dC880d0e8DA6Ae65B9688FD7B';
const CRV = '0xD533a949740bb3306d119CC777fa900bA034cd52';
const CVX = '0x4e3FBD56CD56c3e72c1403e103b45Db9da5B9D2B';
const CNC = '0x9aE380F0272E2162340a5bB646c354271c0F5cFC';

const PRICE_API = 'https://coins.llama.fi/prices/current/ethereum:';
const CURVE_APY_API = 'https://www.convexfinance.com/api/curve-apys';
const CURVE_POOL_API = 'https://api.curve.fi/api/getPools/ethereum/main';

const contract = (a, abi) => new Contract(a, abi, provider);

const addresses = async () => contract(CONTROLLER, controllerAbi).listPools();

const inflationRate = async () => {
  return contract(
    INFLATION_MANAGER,
    inflationManagerAbi
  ).currentInflationRate();
};

const symbol = async (a) => contract(a, erc20Abi).symbol();

const decimals = async (a) => contract(a, erc20Abi).decimals();

const underlying = async (a) => contract(a, poolAbi).underlying();

const totalUnderlying = async (a) => contract(a, poolAbi).totalUnderlying();

const weights = async (a) => contract(a, poolAbi).getWeights();

const bnToNum = (bn, dec = 18) => Number(bn.toString()) / 10 ** dec;

const priceCoin = async (coin) => {
  const response_ = await fetch(`${PRICE_API}${coin}`);
  const data_ = await response_.json();
  return data_.coins[`ethereum:${coin}`].price;
};

const curveApyData = async () => {
  const respose_ = await fetch(CURVE_APY_API);
  const data_ = await respose_.json();
  return data_.apys;
};

const curvePoolData = async () => {
  const response_ = await fetch(CURVE_POOL_API);
  const data_ = await response_.json();
  return data_.data.poolData;
};

const poolApy = (weights_, apyData, poolData) => {
  const base = weights_.reduce((total, weight) => {
    const data = poolData.find((p) => p.address === weight.poolAddress);
    if (!data) return total;
    const apy = apyData[data.id];
    return apy.baseApy * bnToNum(weight.weight) + total;
  }, 0);
  const crv = weights_.reduce((total, weight) => {
    const data = poolData.find((p) => p.address === weight.poolAddress);
    if (!data) return total;
    const apy = apyData[data.id];
    return apy.crvApy * bnToNum(weight.weight) + total;
  }, 0);
  return {
    base,
    crv: crv,
  };
};

const pool = async (address, apyData, poolData) => {
  const [underlying_] = await Promise.all([underlying(address)]);
  const [symbol_, decimals_, totalUnderlying_, price_, weights_] =
    await Promise.all([
      symbol(underlying_),
      decimals(underlying_),
      totalUnderlying(address),
      priceCoin(underlying_),
      weights(address),
    ]);
  return {
    underlying: underlying_,
    symbol: symbol_,
    decimals: decimals_,
    totalUnderlying: bnToNum(totalUnderlying_, decimals_),
    price: price_,
    baseApy: poolApy(weights_, apyData, poolData).base,
    crvApy: poolApy(weights_, apyData, poolData).crv,
  };
};

const pools = async (addresses_) => {
  const [apyData, poolData] = await Promise.all([
    curveApyData(),
    curvePoolData(),
  ]);
  return Promise.all(addresses_.map((a) => pool(a, apyData, poolData)));
};

const conicApy = async () => {
  const addresses_ = await addresses();
  const [pools_, inflationRate_, cncPrice_] = await Promise.all([
    pools(addresses_),
    inflationRate(),
    priceCoin(CNC),
  ]);
  const cncUsdPerYear = bnToNum(inflationRate_) * cncPrice_ * 365 * 86400;
  const totalTvl = pools_.reduce((total, pool_) => {
    return total + pool_.totalUnderlying * pool_.price;
  }, 0);
  const cncApy = (cncUsdPerYear / totalTvl) * 100;
  return Promise.all(
    pools_.map(async (pool_) => {
      const tvlUsd = pool_.totalUnderlying * pool_.price;
      return {
        pool: `conic-${pool_.symbol}-ethereum`.toLowerCase(),
        chain: 'Ethereum',
        project: 'conic-finance',
        symbol: pool_.symbol,
        tvlUsd,
        rewardTokens: [CNC, CRV, CVX],
        underlyingTokens: [pool_.underlying],
        apyBase: pool_.baseApy,
        apyReward: pool_.crvApy + cncApy,
      };
    })
  );
};

module.exports = {
  timetravel: false,
  apy: conicApy,
  url: 'https://conic.finance/',
};
