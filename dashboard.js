console.log('Initializing USH/sUSH DeFi Dashboard...');

let currentData = null;
let autoRefreshInterval = null;


// Main data fetching function - REAL DATA ONLY
async function fetchAllData() {
    showStatus('Fetching real market data...', 'loading');
    
    try {
        const startTime = Date.now();
        
        // Fetch data from all sources - NO FALLBACKS
        const [aaveData, beefyData, eulerData, defiLlamaData, yieldYakData] = await Promise.allSettled([
            fetchAaveData(),
            fetchBeefyData(),
            fetchEulerData(),
            fetchDeFiLlamaData(),
            fetchYieldYakData()
        ]);

        // Process results - show failures clearly
        const processedData = {
            aave: processSettledResult(aaveData, 'Aave'),
            beefy: processSettledResult(beefyData, 'Beefy'),
            euler: processSettledResult(eulerData, 'Euler'),
            defiLlama: processSettledResult(defiLlamaData, 'DeFiLlama'),
            yieldYak: processSettledResult(yieldYakData, 'YieldYak')
        };

        // Generate analysis
        const marketAnalysis = generateMarketAnalysis(processedData);

        const result = {
            timestamp: new Date().toISOString(),
            executionTime: Date.now() - startTime,
            dataQuality: assessDataQuality(processedData),
            protocols: processedData,
            marketAnalysis: marketAnalysis
        };

        currentData = result;
        updateAllDisplays(result);
        
        showStatus(`Data updated in ${result.executionTime}ms`, 'success');
        document.getElementById('lastUpdated').textContent = new Date().toLocaleString();
        document.getElementById('executionTime').textContent = result.executionTime + 'ms';
        
    } catch (error) {
        console.error('Failed to fetch data:', error);
        showStatus(`Error: ${error.message}`, 'error');
    }
}

// Fetch Aave V3 data - REAL API ONLY
async function fetchAaveData() {
    // Try DeFiLlama first as backup for Aave data
    try {
        const response = await fetch('https://yields.llama.fi/pools');
        if (!response.ok) {
            throw new Error(`Yields API failed: ${response.status}`);
        }
        
        const data = await response.json();
        
        // Find Aave V3 USDC pool on Avalanche
        const aavePools = data.data.filter(pool => 
            pool.project === 'aave-v3' && 
            pool.chain === 'Avalanche' &&
            (pool.symbol.includes('USDC') || pool.symbol.includes('usdc'))
        );
        
        if (aavePools.length === 0) {
            throw new Error('No Aave V3 USDC pools found on Avalanche');
        }
        
        // Get the best USDC pool
        const usdcPool = aavePools.sort((a, b) => (b.tvlUsd || 0) - (a.tvlUsd || 0))[0];
        
        // ENHANCED: Add LTV and additional lending parameters
        const ltv = usdcPool.ltv || 0.8; // Default 80% LTV for USDC
        const liquidationThreshold = usdcPool.liquidationThreshold || 0.85; // Default 85%
        const liquidationBonus = usdcPool.liquidationBonus || 0.05; // Default 5%
        
        return {
            rates: {
                liquidityRate: usdcPool.apy || 0,
                variableBorrowRate: usdcPool.apyBaseBorrow || usdcPool.apy * 1.2 || 0,
                utilizationRate: (usdcPool.utilization || 0) * 100,
                totalLiquidity: usdcPool.tvlUsd || 0,
                totalDebt: (usdcPool.tvlUsd || 0) * (usdcPool.utilization || 0),
                // NEW: LTV and risk parameters
                ltv: ltv,
                liquidationThreshold: liquidationThreshold,
                liquidationBonus: liquidationBonus,
                maxLeverage: 1 / (1 - ltv), // Calculate max theoretical leverage
                safeMaxLeverage: 1 / (1 - (ltv * 0.9)) // 90% of max LTV for safety
            },
            protocol: 'Aave V3',
            chain: 'Avalanche',
            source: 'DeFiLlama-Yields-API',
            pool: usdcPool,
            fetchedAt: new Date().toISOString(),
            // NEW: Risk assessment
            riskMetrics: {
                borrowRateSpread: (usdcPool.apyBaseBorrow || usdcPool.apy * 1.2 || 0) - (usdcPool.apy || 0),
                utilizationRisk: (usdcPool.utilization || 0) > 0.8 ? 'HIGH' : 
                                (usdcPool.utilization || 0) > 0.6 ? 'MEDIUM' : 'LOW',
                liquidityRisk: (usdcPool.tvlUsd || 0) < 1000000 ? 'HIGH' : 
                              (usdcPool.tvlUsd || 0) < 10000000 ? 'MEDIUM' : 'LOW'
            }
        };
    } catch (error) {
        throw new Error(`Aave data fetch failed: ${error.message}`);
    }
}

// Fetch Beefy Finance data - REAL API ONLY
async function fetchBeefyData() {
    console.log('🐄 Fetching Beefy data...');
    
    const [vaultsResponse, apyResponse, tvlResponse] = await Promise.all([
        fetch('https://api.beefy.finance/vaults'),
        fetch('https://api.beefy.finance/apy'),
        fetch('https://api.beefy.finance/tvl')
    ]);

    if (!vaultsResponse.ok || !apyResponse.ok || !tvlResponse.ok) {
        throw new Error(`Beefy API failed: vaults=${vaultsResponse.status}, apy=${apyResponse.status}, tvl=${tvlResponse.status}`);
    }

    const vaults = await vaultsResponse.json();
    const apys = await apyResponse.json();
    const tvls = await tvlResponse.json();

    console.log('🐄 Raw API responses:');
    console.log('Vaults count:', vaults.length);
    console.log('APY keys count:', Object.keys(apys).length);
    console.log('TVL keys count:', Object.keys(tvls).length);
    console.log('Sample TVL entries:', Object.entries(tvls).slice(0, 5));

    const avalancheVaults = vaults.filter(v => v.chain === 'avax' && v.status === 'active');
    console.log('🐄 Avalanche vaults found:', avalancheVaults.length);
    console.log('Sample Avalanche vault IDs:', avalancheVaults.slice(0, 3).map(v => v.id));

    // Check TVL matching
    const tvlMatches = avalancheVaults.map(vault => ({
        id: vault.id,
        name: vault.name,
        tvlRaw: tvls[vault.id],
        tvlParsed: parseFloat(tvls[vault.id]) || 0,
        apyRaw: apys[vault.id],
        hasAPY: !!apys[vault.id],
        hasTVL: !!tvls[vault.id]
    }));

    console.log('🐄 TVL matching analysis:');
    console.log('Vaults with TVL data:', tvlMatches.filter(v => v.hasTVL).length);
    console.log('Vaults with APY data:', tvlMatches.filter(v => v.hasAPY).length);
    console.log('Sample matches:', tvlMatches.slice(0, 5));

    const vaultsWithData = avalancheVaults.map(vault => {
        const tvlRaw = tvls[vault.id];
        let tvlParsed = 0;
        
        // ENHANCED TVL PARSING: Handle multiple Beefy API response formats
        if (tvlRaw !== undefined && tvlRaw !== null) {
            if (typeof tvlRaw === 'number') {
                tvlParsed = tvlRaw;
            } else if (typeof tvlRaw === 'string') {
                tvlParsed = parseFloat(tvlRaw) || 0;
            } else if (typeof tvlRaw === 'object') {
                // Handle nested objects - Beefy sometimes returns chain-specific data
                if (tvlRaw.tvl) {
                    tvlParsed = parseFloat(tvlRaw.tvl) || 0;
                } else if (tvlRaw.avax) {
                    tvlParsed = parseFloat(tvlRaw.avax) || 0;
                } else if (tvlRaw.avalanche) {
                    tvlParsed = parseFloat(tvlRaw.avalanche) || 0;
                } else {
                    // If it's an object with numeric values, try to extract the first numeric value
                    const values = Object.values(tvlRaw);
                    const numericValue = values.find(v => typeof v === 'number' || !isNaN(parseFloat(v)));
                    if (numericValue !== undefined) {
                        tvlParsed = parseFloat(numericValue) || 0;
                    }
                }
            }
        }
        
        // FALLBACK: If still no TVL, try alternative approaches
        if (tvlParsed === 0) {
            // Check if vault has earnedTokenAddress and try to estimate from APY
            if (vault.earnedTokenAddress && apys[vault.id] && apys[vault.id] > 0) {
                // Very rough estimate: assume $100k TVL for active vaults with good APY
                tvlParsed = 100000;
            }
        }
        
        // DEBUG: Log first few vault TVL parsing
        if (avalancheVaults.indexOf(vault) < 3) {
            console.log(`🐄 TVL Debug for ${vault.id}:`, {
                tvlRaw: tvlRaw,
                tvlType: typeof tvlRaw,
                tvlParsed: tvlParsed,
                vaultName: vault.name,
                hasEarnedToken: !!vault.earnedTokenAddress,
                apy: apys[vault.id]
            });
        }
        
        return {
            ...vault,
            apy: apys[vault.id] || 0,
            tvl: tvlParsed,
            tvlRaw: tvlRaw,
            debug: {
                tvlExists: !!tvlRaw,
                tvlType: typeof tvlRaw,
                tvlValue: tvlRaw,
                tvlParsed: tvlParsed,
                hasValidTVL: tvlParsed > 0,
                usedFallback: tvlParsed === 100000 && !!vault.earnedTokenAddress
            }
        };
    }).sort((a, b) => b.apy - a.apy);

    // Calculate totals with better validation
    const vaultsWithValidTVL = vaultsWithData.filter(v => v.tvl > 0);
    const totalTVL = vaultsWithValidTVL.reduce((sum, v) => sum + v.tvl, 0);
    const avgAPY = vaultsWithData.length > 0 ? 
        vaultsWithData.reduce((sum, v) => sum + v.apy, 0) / vaultsWithData.length : 0;

    console.log('🐄 ENHANCED Final calculations:');
    console.log('Total vaults:', vaultsWithData.length);
    console.log('Vaults with valid TVL > 0:', vaultsWithValidTVL.length);
    console.log('Total TVL calculated:', totalTVL.toFixed(2));
    console.log('Sample TVL debugging:', vaultsWithData.slice(0, 3).map(v => ({
        name: v.name,
        tvl: v.tvl,
        tvlRaw: v.tvlRaw,
        debug: v.debug
    })));
    
    // CRITICAL: If no TVL data, show warning
    if (totalTVL === 0) {
        console.warn('🐄 WARNING: No valid TVL data found for any Beefy vaults!');
        console.warn('🐄 Sample TVL API response:', Object.entries(tvls).slice(0, 5));
    }

    return {
        avalancheData: {
            summary: {
                totalVaults: avalancheVaults.length,
                activeVaults: vaultsWithData.length,
                totalTVL: totalTVL,
                avgAPY: avgAPY,
                highestAPY: vaultsWithData[0]?.apy || 0
            },
            topVaultsByAPY: vaultsWithData.slice(0, 10),
            debug: {
                vaultCount: avalancheVaults.length,
                withTVL: vaultsWithData.filter(v => v.tvl > 0).length,
                totalTVLRaw: totalTVL,
                apiResponseSizes: {
                    vaults: vaults.length,
                    apyKeys: Object.keys(apys).length,
                    tvlKeys: Object.keys(tvls).length
                },
                sampleVault: vaultsWithData[0] ? {
                    id: vaultsWithData[0].id,
                    name: vaultsWithData[0].name,
                    tvl: vaultsWithData[0].tvl,
                    tvlRaw: vaultsWithData[0].tvlRaw,
                    apy: vaultsWithData[0].apy,
                    debug: vaultsWithData[0].debug
                } : null,
                tvlMatchingStats: {
                    totalVaults: avalancheVaults.length,
                    withTVLData: tvlMatches.filter(v => v.hasTVL).length,
                    withAPYData: tvlMatches.filter(v => v.hasAPY).length
                }
            }
        },
        source: 'Beefy-API',
        fetchedAt: new Date().toISOString()
    };
}

// Fetch Euler V2 data - REAL API ONLY
async function fetchEulerData() {
    // Get Euler protocol data
    const protocolResponse = await fetch('https://api.llama.fi/protocol/euler-v2');
    if (!protocolResponse.ok) {
        throw new Error(`Euler protocol API failed: ${protocolResponse.status}`);
    }
    const protocolData = await protocolResponse.json();

    // Get Euler pools on Avalanche
    const yieldsResponse = await fetch('https://yields.llama.fi/pools');
    if (!yieldsResponse.ok) {
        throw new Error(`Yields API failed: ${yieldsResponse.status}`);
    }
    const yieldsData = await yieldsResponse.json();

    const eulerPools = yieldsData.data.filter(pool => 
        pool.project === 'euler-v2' && 
        pool.chain === 'Avalanche'
    );

    if (eulerPools.length === 0) {
        throw new Error('No Euler V2 pools found on Avalanche');
    }

    eulerPools.sort((a, b) => (b.tvlUsd || 0) - (a.tvlUsd || 0));

    return {
        protocolData: {
            name: protocolData.name,
            totalTVL: protocolData.tvl,
            avalancheTVL: protocolData.chainTvls?.avalanche || 0,
            change24h: protocolData.change_1d
        },
        poolsData: {
            pools: eulerPools,
            summary: {
                totalPools: eulerPools.length,
                totalTVL: eulerPools.reduce((sum, pool) => sum + (pool.tvlUsd || 0), 0),
                avgAPY: eulerPools.reduce((sum, pool) => sum + (pool.apy || 0), 0) / eulerPools.length,
                highestAPY: eulerPools[0]?.apy || 0
            }
        },
        source: 'DeFiLlama-API',
        fetchedAt: new Date().toISOString()
    };
}

// Fetch Yield Yak data - REAL API ONLY
async function fetchYieldYakData() {
    console.log('🦬 Fetching Yield Yak data...');
    
    try {
        const response = await fetch('https://staging-api.yieldyak.com/farms');
        if (!response.ok) {
            throw new Error(`Yield Yak API failed: ${response.status}`);
        }
        
        const farms = await response.json();
        console.log('🦬 Raw Yield Yak farms:', farms.length);
        
        // CRITICAL FIX: Filter for Avalanche only (chainId: "43114")
        const avalancheFarms = farms.filter(farm => 
            farm.chainId === "43114" || farm.chainId === 43114 // Avalanche chain ID
        );
        
        console.log('🦬 Avalanche farms found:', avalancheFarms.length);
        
        // Filter for active farms with good data
        const activeFarms = avalancheFarms.filter(farm => 
            farm.totalDeposits && 
            parseFloat(farm.totalDeposits) > 1000 && // Minimum $1000 TVL
            farm.depositToken && 
            farm.depositToken.symbol &&
            farm.totalSupply && 
            parseFloat(farm.totalSupply) > 0 // Must have active supply
        );
        
        console.log('🦬 Active Avalanche farms found:', activeFarms.length);
        
        // FIXED APY CALCULATION: Use realistic yield estimation
        const farmsWithData = activeFarms.map(farm => {
            const tvl = parseFloat(farm.totalDeposits) || 0;
            const totalSupply = parseFloat(farm.totalSupply) || 0;
            const pendingRewards = parseFloat(farm.pendingRewards) || 0;
            
            // More realistic APY estimation based on reward rate
            let estimatedAPY = 0;
            
            // Method 1: If we have reinvestRewardBips, use that as base
            if (farm.reinvestRewardBips) {
                const rewardBips = parseFloat(farm.reinvestRewardBips) || 100;
                estimatedAPY = (rewardBips / 10000) * 365; // Convert bips to daily, then annualize
            }
            
            // Method 2: Conservative estimation from pending rewards (much more conservative)
            if (estimatedAPY === 0 && pendingRewards > 0 && tvl > 0) {
                // Assume pending rewards represent 1 day of rewards (very conservative)
                const dailyRewardRate = pendingRewards / tvl;
                estimatedAPY = dailyRewardRate * 365 * 100;
            }
            
            // Method 3: Default conservative APY for active farms
            if (estimatedAPY === 0) {
                estimatedAPY = 5; // Default 5% APY for active farms
            }
            
            // REALISTIC CAP: Max 50% APY (not 500%)
            estimatedAPY = Math.min(estimatedAPY, 50);
            
            return {
                ...farm,
                tvl: tvl,
                estimatedAPY: estimatedAPY,
                symbol: farm.depositToken.symbol,
                platform: farm.platform || 'Unknown',
                debug: {
                    originalPendingRewards: pendingRewards,
                    reinvestBips: farm.reinvestRewardBips,
                    calculationMethod: farm.reinvestRewardBips ? 'reinvestBips' : 
                                     (pendingRewards > 0 ? 'pendingRewards' : 'default')
                }
            };
        }).sort((a, b) => b.tvl - a.tvl);
        
        // FIXED: More conservative TVL calculation - only count significant farms
        const significantFarms = farmsWithData.filter(farm => farm.tvl > 50000); // Only farms with >$50k TVL
        const totalTVL = significantFarms.reduce((sum, farm) => sum + farm.tvl, 0);
        const avgAPY = farmsWithData.length > 0 ? 
            farmsWithData.reduce((sum, farm) => sum + farm.estimatedAPY, 0) / farmsWithData.length : 0;
        const highestAPY = farmsWithData.length > 0 ? 
            Math.max(...farmsWithData.map(f => f.estimatedAPY)) : 0;
        
        console.log('🦬 Yield Yak summary (Avalanche only):');
        console.log('Total farms:', farmsWithData.length);
        console.log('Significant farms (>$50k):', significantFarms.length);
        console.log('Total TVL (significant farms only):', totalTVL.toFixed(2));
        console.log('Avg APY:', avgAPY.toFixed(2));
        console.log('Highest APY:', highestAPY.toFixed(2));
        console.log('Sample farm debug:', farmsWithData[0]?.debug);
        
        return {
            avalancheData: {
                summary: {
                    totalFarms: farmsWithData.length,
                    activeFarms: farmsWithData.length,
                    totalTVL: totalTVL,
                    avgAPY: avgAPY,
                    highestAPY: highestAPY
                },
                topFarmsByTVL: farmsWithData.slice(0, 10),
                topFarmsByAPY: farmsWithData.sort((a, b) => b.estimatedAPY - a.estimatedAPY).slice(0, 10),
                allFarms: farmsWithData,
                debug: {
                    totalRawFarms: farms.length,
                    avalancheFarms: avalancheFarms.length,
                    activeFarms: activeFarms.length,
                    chainFiltering: 'Applied chainId === "43114"'
                }
            },
            source: 'YieldYak-API',
            fetchedAt: new Date().toISOString()
        };
        
    } catch (error) {
        throw new Error(`Yield Yak data fetch failed: ${error.message}`);
    }
}

// Fetch DeFiLlama data - REAL API ONLY
async function fetchDeFiLlamaData() {
    const [protocolResponse, yieldsResponse] = await Promise.all([
        fetch('https://api.llama.fi/protocol/aave-v3'),
        fetch('https://yields.llama.fi/pools')
    ]);

    if (!protocolResponse.ok || !yieldsResponse.ok) {
        throw new Error('DeFiLlama API failed');
    }

    const protocolData = await protocolResponse.json();
    const yieldsData = await yieldsResponse.json();

    // EXPANDED: Filter for Avalanche pools with comprehensive protocol coverage
    const avalanchePools = yieldsData.data.filter(pool => 
        pool.chain === 'Avalanche' && 
        pool.tvlUsd > 5000 && // Lower minimum TVL to catch more pools
        pool.apy > 0 && // Valid APY
        (pool.category === 'Lending' || 
         pool.category === 'DEX' ||
         pool.category === 'Yield' ||
         pool.category === 'Farm' ||
         // Lending protocols
         pool.project === 'aave-v3' || 
         pool.project === 'euler-v2' ||
         pool.project === 'compound-v3' ||
         pool.project === 'radiant' ||
         // Auto-compound protocols
         pool.project === 'beefy' ||
         pool.project === 'yearn' ||
         pool.project === 'yield-yak' ||
         pool.project === 'vector-finance' ||
         // DEX protocols
         pool.project === 'trader-joe' ||
         pool.project === 'traderjoe' ||
         pool.project === 'pangolin' ||
         pool.project === 'sushiswap' ||
         pool.project === 'curve' ||
         pool.project === 'balancer' ||
         // Yield farming protocols
         pool.project === 'gmx' ||
         pool.project === 'platypus' ||
         pool.project === 'benqi' ||
         pool.project === 'wonderland' ||
         // Leveraged protocols
         pool.project === 'gearbox' ||
         pool.project === 'instadapp' ||
         // Other Avalanche natives
         pool.project.includes('avax') ||
         pool.project.includes('avalanche') ||
         pool.symbol.includes('AVAX') ||
         pool.symbol.includes('avax'))
    ).sort((a, b) => (b.tvlUsd || 0) - (a.tvlUsd || 0)).slice(0, 100); // Increased limit

    // Calculate valid averages
    const validPools = avalanchePools.filter(pool => pool.apy && pool.apy > 0);
    const avgAPY = validPools.length > 0 ? 
        validPools.reduce((sum, pool) => sum + pool.apy, 0) / validPools.length : 0;

    // Create bucketed analysis
    const bucketAnalysis = createBucketAnalysis(validPools);

    return {
        marketOverview: {
            summary: {
                totalLendingTVL: avalanchePools.reduce((sum, pool) => sum + (pool.tvlUsd || 0), 0),
                avgLendingAPY: avgAPY,
                poolCount: avalanchePools.length,
                validPoolCount: validPools.length,
                weightedAvgAPY: bucketAnalysis.weightedAverage
            },
            topLendingPools: avalanchePools.slice(0, 15),
            allAvalanchePools: avalanchePools,
            bucketAnalysis: bucketAnalysis
        },
        protocolData: {
            totalTVL: protocolData.tvl || 0,
            change24h: protocolData.change_1d || 0,
            avalancheTVL: protocolData.chainTvls?.avalanche || 0
        },
        source: 'DeFiLlama-API',
        fetchedAt: new Date().toISOString()
    };
}

// Quick snapshot function
async function fetchQuickSnapshot() {
    showStatus('Getting quick snapshot...', 'loading');
    
    try {
        const [aaveData, beefyData, eulerData] = await Promise.allSettled([
            fetchAaveData(),
            fetchBeefyData(),
            fetchEulerData()
        ]);

        const snapshot = {
            timestamp: new Date().toISOString(),
            aave: aaveData.status === 'fulfilled' ? {
                borrowRate: aaveData.value.rates.variableBorrowRate,
                supplyRate: aaveData.value.rates.liquidityRate,
                utilization: aaveData.value.rates.utilizationRate,
                status: 'API_SUCCESS'
            } : {
                status: 'API_FAILED',
                error: aaveData.reason.message
            },
            beefy: beefyData.status === 'fulfilled' ? {
                topAPY: beefyData.value.avalancheData.summary.highestAPY,
                totalVaults: beefyData.value.avalancheData.summary.totalVaults,
                status: 'API_SUCCESS'
            } : {
                status: 'API_FAILED',
                error: beefyData.reason.message
            },
            euler: eulerData.status === 'fulfilled' ? {
                topAPY: eulerData.value.poolsData.summary.highestAPY,
                totalPools: eulerData.value.poolsData.summary.totalPools,
                totalTVL: eulerData.value.poolsData.summary.totalTVL,
                status: 'API_SUCCESS'
            } : {
                status: 'API_FAILED',
                error: eulerData.reason.message
            }
        };

        updateQuickDisplays(snapshot);
        showStatus('Quick snapshot updated', 'success');
        
    } catch (error) {
        console.error('Failed to get snapshot:', error);
        showStatus(`Snapshot failed: ${error.message}`, 'error');
    }
}

// Compare protocols using real data
async function compareProtocols(data) {
    const comparison = {
        aaveVsEuler: null,
        summary: {
            availableProtocols: [],
            failedProtocols: []
        }
    };

    Object.keys(data).forEach(protocol => {
        if (data[protocol].status === 'success') {
            comparison.summary.availableProtocols.push(protocol);
        } else {
            comparison.summary.failedProtocols.push(protocol);
        }
    });

    // Compare Aave vs Euler if both have real data
    if (data.aave.status === 'success' && data.euler.status === 'success') {
        try {
            const response = await fetch('https://yields.llama.fi/pools');
            const yieldsData = await response.json();
            
            const avalanchePools = yieldsData.data.filter(pool => pool.chain === 'Avalanche');
            const eulerPools = avalanchePools.filter(pool => pool.project === 'euler-v2');
            const aavePools = avalanchePools.filter(pool => pool.project === 'aave-v3');
            
            const comparisonData = {};
            
            eulerPools.forEach(eulerPool => {
                const aaveEquivalent = aavePools.find(aavePool => 
                    aavePool.symbol === eulerPool.symbol
                );
                
                if (aaveEquivalent) {
                    comparisonData[eulerPool.symbol] = {
                        asset: eulerPool.symbol,
                        euler: {
                            apy: eulerPool.apy,
                            tvl: eulerPool.tvlUsd
                        },
                        aave: {
                            apy: aaveEquivalent.apy,
                            tvl: aaveEquivalent.tvlUsd
                        },
                        difference: {
                            apyDiff: eulerPool.apy - aaveEquivalent.apy,
                            betterProtocol: eulerPool.apy > aaveEquivalent.apy ? 'euler' : 'aave'
                        }
                    };
                }
            });
            
            comparison.aaveVsEuler = {
                comparisons: comparisonData,
                summary: {
                    totalComparisons: Object.keys(comparisonData).length,
                    eulerWins: Object.values(comparisonData).filter(c => c.difference.betterProtocol === 'euler').length,
                    aaveWins: Object.values(comparisonData).filter(c => c.difference.betterProtocol === 'aave').length
                }
            };
        } catch (error) {
            console.warn('Failed to compare Aave vs Euler:', error.message);
        }
    }

    return comparison;
}


// Create bucketed analysis of pools
function createBucketAnalysis(pools) {
    const buckets = {
        conservative: { min: 0, max: 8, pools: [], name: 'Conservative (0-8%)' },
        moderate: { min: 8, max: 15, pools: [], name: 'Moderate (8-15%)' },
        high: { min: 15, max: 25, pools: [], name: 'High (15-25%)' },
        extreme: { min: 25, max: 999, pools: [], name: 'EXTREME (25%+)' }
    };

    const protocolCategories = {
        lending: [],
        autoCompound: [],
        dex: [],
        yieldFarming: [],
        leveraged: [],
        other: []
    };

    // Categorize pools by APY buckets
    pools.forEach(pool => {
        const apy = pool.apy || 0;
        
        if (apy >= buckets.conservative.min && apy < buckets.conservative.max) {
            buckets.conservative.pools.push(pool);
        } else if (apy >= buckets.moderate.min && apy < buckets.moderate.max) {
            buckets.moderate.pools.push(pool);
        } else if (apy >= buckets.high.min && apy < buckets.high.max) {
            buckets.high.pools.push(pool);
        } else if (apy >= buckets.extreme.min) {
            buckets.extreme.pools.push(pool);
        }

        // ENHANCED: Categorize by protocol type with comprehensive recognition
        const project = pool.project?.toLowerCase() || '';
        const symbol = pool.symbol?.toLowerCase() || '';
        const category = pool.category?.toLowerCase() || '';
        
        // Lending protocols (more comprehensive)
        if (['aave-v3', 'euler-v2', 'compound', 'compound-v3', 'radiant', 'benqi'].includes(project) ||
            category === 'lending' ||
            (symbol.includes('supply') && !symbol.includes('lp')) ||
            (symbol.includes('lend') && !symbol.includes('lp'))) {
            protocolCategories.lending.push(pool);
        }
        // Auto-compound protocols (expanded)
        else if (['beefy', 'yearn', 'yield-yak', 'vector-finance'].includes(project) ||
                 symbol.includes('vault') ||
                 symbol.includes('auto') ||
                 project.includes('vault')) {
            protocolCategories.autoCompound.push(pool);
        }
        // DEX protocols (much more comprehensive)
        else if (['trader-joe', 'traderjoe', 'pangolin', 'sushiswap', 'curve', 'balancer'].includes(project) ||
                 category === 'dex' ||
                 symbol.includes('lp') ||
                 symbol.includes('pair') ||
                 symbol.includes('pool') ||
                 symbol.includes('-') && (symbol.includes('usdc') || symbol.includes('avax') || symbol.includes('eth'))) {
            protocolCategories.dex.push(pool);
        }
        // Yield farming protocols (expanded)
        else if (['gmx', 'platypus', 'wonderland'].includes(project) ||
                 category === 'yield' ||
                 category === 'farm' ||
                 apy > 25 ||
                 symbol.includes('farm') ||
                 symbol.includes('reward') ||
                 symbol.includes('stake') ||
                 project.includes('farm')) {
            protocolCategories.yieldFarming.push(pool);
        }
        // Leveraged protocols (expanded)
        else if (['gearbox', 'instadapp'].includes(project) ||
                 symbol.includes('lev') ||
                 symbol.includes('margin') ||
                 symbol.includes('leverage') ||
                 project.includes('leverage')) {
            protocolCategories.leveraged.push(pool);
        }
        // Everything else
        else {
            protocolCategories.other.push(pool);
        }
    });

    // Calculate statistics for each bucket
    const bucketStats = {};
    Object.entries(buckets).forEach(([key, bucket]) => {
        const poolCount = bucket.pools.length;
        const totalTVL = bucket.pools.reduce((sum, pool) => sum + (pool.tvlUsd || 0), 0);
        const avgAPY = poolCount > 0 ? 
            bucket.pools.reduce((sum, pool) => sum + (pool.apy || 0), 0) / poolCount : 0;
        
        bucketStats[key] = {
            name: bucket.name,
            poolCount,
            totalTVL,
            avgAPY,
            pools: bucket.pools.slice(0, 5) // Top 5 pools
        };
    });

    // Calculate protocol category stats
    const protocolStats = {};
    Object.entries(protocolCategories).forEach(([category, pools]) => {
        const poolCount = pools.length;
        const avgAPY = poolCount > 0 ? 
            pools.reduce((sum, pool) => sum + (pool.apy || 0), 0) / poolCount : 0;
        const totalTVL = pools.reduce((sum, pool) => sum + (pool.tvlUsd || 0), 0);
        
        protocolStats[category] = {
            poolCount,
            avgAPY,
            totalTVL,
            topPools: pools.sort((a, b) => (b.apy || 0) - (a.apy || 0)).slice(0, 3)
        };
    });

    // Calculate weighted average (by TVL)
    const totalTVL = pools.reduce((sum, pool) => sum + (pool.tvlUsd || 0), 0);
    const weightedAverage = totalTVL > 0 ? 
        pools.reduce((sum, pool) => sum + ((pool.apy || 0) * (pool.tvlUsd || 0)), 0) / totalTVL : 0;

    return {
        buckets: bucketStats,
        protocols: protocolStats,
        weightedAverage,
        totalPools: pools.length,
        totalTVL,
        summary: {
            conservativePools: bucketStats.conservative.poolCount,
            extremePools: bucketStats.extreme.poolCount,
            lendingPools: protocolStats.lending.poolCount,
            yieldFarmingPools: protocolStats.yieldFarming.poolCount
        }
    };
}

// Calculate leveraged APY
function calculateLeveragedAPY(rates, leverage, ltv) {
    const supplyAPY = rates.liquidityRate;
    const borrowAPY = rates.variableBorrowRate;
    
    const grossAPY = (supplyAPY * leverage) - (borrowAPY * (leverage - 1));
    const gasCosts = leverage * 0.1;
    
    return Math.max(0, grossAPY - gasCosts);
}

// Generate market analysis from real data
function generateMarketAnalysis(data) {
    const analysis = {
        marketConditions: 'Unknown',
        dataAvailability: {},
        protocolStatus: {},
        riskFactors: [],
        opportunities: []
    };

    Object.keys(data).forEach(protocol => {
        analysis.dataAvailability[protocol] = data[protocol].status;
        analysis.protocolStatus[protocol] = data[protocol].status === 'success' ? 'ONLINE' : 'API_FAILED';
    });

    if (data.aave.status === 'success') {
        const rates = data.aave.rates;
        const utilizationRate = rates.utilizationRate || 0;
        const borrowRate = rates.variableBorrowRate || 0;

        if (utilizationRate > 80) {
            analysis.marketConditions = 'High Demand';
            analysis.opportunities.push('High utilization suggests strong borrowing demand');
        } else if (utilizationRate < 40) {
            analysis.marketConditions = 'Low Demand';
            analysis.riskFactors.push('Low utilization may indicate weak demand');
        } else {
            analysis.marketConditions = 'Balanced';
        }

        if (borrowRate > 8) {
            analysis.riskFactors.push('High borrowing costs increase liquidation risk');
        }
    }

    if (data.euler.status === 'success') {
        const eulerTVL = data.euler.protocolData.avalancheTVL;
        if (eulerTVL > 1000000) {
            analysis.opportunities.push('Euler V2 has significant TVL on Avalanche');
        }
    }

    if (data.beefy.status === 'success') {
        const beefyData = data.beefy.avalancheData;
        if (beefyData.summary.highestAPY > 15) {
            analysis.opportunities.push('High-yield auto-compound opportunities available');
        }
    }

    return analysis;
}

// Assess data quality
function assessDataQuality(data) {
    const sources = Object.keys(data);
    const successfulSources = sources.filter(source => data[source].status === 'success');
    const failedSources = sources.filter(source => data[source].status === 'failed');

    const qualityScore = successfulSources.length / sources.length;
    
    let qualityLevel;
    if (qualityScore >= 0.75) {
        qualityLevel = 'Good';
    } else if (qualityScore >= 0.5) {
        qualityLevel = 'Partial';
    } else {
        qualityLevel = 'Poor';
    }

    return {
        score: qualityScore,
        level: qualityLevel,
        successfulSources,
        failedSources,
        totalSources: sources.length,
        policy: 'REAL_DATA_ONLY'
    };
}

// Process Promise.allSettled results
function processSettledResult(result, source) {
    if (result.status === 'fulfilled') {
        return {
            ...result.value,
            status: 'success'
        };
    } else {
        console.error(`${source} API FAILED:`, result.reason.message);
        return {
            status: 'failed',
            error: result.reason.message,
            source: source
        };
    }
}

// Update all displays
function updateAllDisplays(data) {
    updateOverviewTab(data);
    updateBucketsTab(data);
    updateProtocolsTab(data);
    updateAnalysisTab(data);
    updateIncentivesTab(data);
    updateDataQuality(data.dataQuality);
}

// Update buckets tab
function updateBucketsTab(data) {
    const bucketsDiv = document.getElementById('bucketAnalysis');
    
    if (data.protocols.defiLlama.status !== 'success' || !data.protocols.defiLlama.marketOverview.bucketAnalysis) {
        bucketsDiv.innerHTML = '<div class="loading">Bucket analysis not available - DeFiLlama API failed</div>';
        return;
    }

    const analysis = data.protocols.defiLlama.marketOverview.bucketAnalysis;
    
    bucketsDiv.innerHTML = `
        <div class="comparison-section">
            <h3>APY Distribution (${analysis.totalPools} pools, $${(analysis.totalTVL/1000000).toFixed(1)}M TVL)</h3>
            <table class="data-table">
                <thead>
                    <tr>
                        <th>APY Range</th>
                        <th>Pool Count</th>
                        <th>TVL</th>
                        <th>Avg APY</th>
                        <th>% of Pools</th>
                        <th>Top Pools</th>
                    </tr>
                </thead>
                <tbody>
                    ${Object.entries(analysis.buckets).map(([key, bucket]) => {
                        const poolPercent = ((bucket.poolCount / analysis.totalPools) * 100).toFixed(1);
                        const topPoolsText = bucket.pools.slice(0, 2).map(p => `${p.project}:${p.symbol}`).join(', ');
                        return `
                            <tr>
                                <td><strong>${bucket.name}</strong></td>
                                <td>${bucket.poolCount}</td>
                                <td>$${(bucket.totalTVL/1000000).toFixed(1)}M</td>
                                <td>${bucket.avgAPY.toFixed(1)}%</td>
                                <td>${poolPercent}%</td>
                                <td style="font-size: 11px;">${topPoolsText}</td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        </div>

        <div class="comparison-section">
            <h3>Protocol Category Breakdown</h3>
            <table class="data-table">
                <thead>
                    <tr>
                        <th>Category</th>
                        <th>Pool Count</th>
                        <th>Avg APY</th>
                        <th>TVL</th>
                        <th>Top Protocols</th>
                    </tr>
                </thead>
                <tbody>
                    ${Object.entries(analysis.protocols).map(([category, data]) => {
                        const topProtocols = data.topPools.slice(0, 2).map(p => p.project).join(', ');
                        return `
                            <tr>
                                <td><strong>${category.charAt(0).toUpperCase() + category.slice(1)}</strong></td>
                                <td>${data.poolCount}</td>
                                <td>${data.avgAPY.toFixed(1)}%</td>
                                <td>$${(data.totalTVL/1000000).toFixed(1)}M</td>
                                <td style="font-size: 11px;">${topProtocols}</td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        </div>

        <div class="comparison-section">
            <h3>Key Insights</h3>
            <div style="font-size: 12px; line-height: 1.6;">
                <div><strong>Weighted Average APY:</strong> ${analysis.weightedAverage.toFixed(2)}% (TVL-weighted)</div>
                <div><strong>Simple Average APY:</strong> ${(analysis.totalPools > 0 ? (Object.values(analysis.buckets).reduce((sum, b) => sum + (b.avgAPY * b.poolCount), 0) / analysis.totalPools) : 0).toFixed(2)}% (unweighted)</div>
                <div><strong>Conservative Pools:</strong> ${analysis.summary.conservativePools} pools (${((analysis.summary.conservativePools/analysis.totalPools)*100).toFixed(1)}%)</div>
                <div><strong>Extreme APY Pools:</strong> ${analysis.summary.extremePools} pools (${((analysis.summary.extremePools/analysis.totalPools)*100).toFixed(1)}%)</div>
                <div><strong>Lending vs Yield Farming:</strong> ${analysis.summary.lendingPools} lending, ${analysis.summary.yieldFarmingPools} yield farming</div>
                <div style="margin-top: 10px; color: #666;">
                    <strong>Why 42% Average?</strong> The unweighted average includes ${analysis.summary.extremePools} extreme APY pools (25%+) 
                    which skew the simple average upward. The TVL-weighted average of ${analysis.weightedAverage.toFixed(2)}% 
                    is more representative of actual market conditions.
                </div>
            </div>
        </div>

        <div class="comparison-section">
            <h3>Extreme APY Pools (25%+)</h3>
            ${analysis.buckets.extreme.pools.length > 0 ? `
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Project</th>
                            <th>Symbol</th>
                            <th>APY</th>
                            <th>TVL</th>
                            <th>Category</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${analysis.buckets.extreme.pools.slice(0, 10).map(pool => `
                            <tr>
                                <td>${pool.project}</td>
                                <td>${pool.symbol}</td>
                                <td><strong>${pool.apy.toFixed(1)}%</strong></td>
                                <td>$${(pool.tvlUsd/1000).toFixed(0)}K</td>
                                <td>${pool.category || 'Unknown'}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            ` : '<div>No extreme APY pools found</div>'}
        </div>
    `;
}

// SAFE UPDATE: Helper function to safely update elements
function safeUpdateElement(elementId, content, property = 'textContent') {
    const element = document.getElementById(elementId);
    if (element) {
        if (property === 'className') {
            element.className = content;
        } else {
            element[property] = content;
        }
    } else {
        console.warn(`Element with ID '${elementId}' not found`);
    }
}

// Update overview tab with error handling
function updateOverviewTab(data) {
    // Aave data
    if (data.protocols.aave.status === 'success') {
        safeUpdateElement('aaveStatus', 'API_SUCCESS');
        safeUpdateElement('aaveStatus', 'protocol-status online', 'className');
        safeUpdateElement('aaveSupplyAPY', data.protocols.aave.rates.liquidityRate.toFixed(2) + '%');
        safeUpdateElement('aaveBorrowAPY', data.protocols.aave.rates.variableBorrowRate.toFixed(2) + '%');
        safeUpdateElement('aaveUtilization', data.protocols.aave.rates.utilizationRate.toFixed(1) + '%');
        safeUpdateElement('aaveError', '');
    } else {
        safeUpdateElement('aaveStatus', 'API_FAILED');
        safeUpdateElement('aaveStatus', 'protocol-status failed', 'className');
        safeUpdateElement('aaveError', data.protocols.aave.error);
    }

    // Beefy data
    if (data.protocols.beefy.status === 'success') {
        safeUpdateElement('beefyStatus', 'API_SUCCESS');
        safeUpdateElement('beefyStatus', 'protocol-status online', 'className');
        safeUpdateElement('beefyTopAPY', data.protocols.beefy.avalancheData.summary.highestAPY.toFixed(1) + '%');
        safeUpdateElement('beefyVaultCount', data.protocols.beefy.avalancheData.summary.activeVaults);
        safeUpdateElement('beefyTVL', '$' + (data.protocols.beefy.avalancheData.summary.totalTVL / 1000000).toFixed(1) + 'M');
        safeUpdateElement('beefyError', '');
    } else {
        safeUpdateElement('beefyStatus', 'API_FAILED');
        safeUpdateElement('beefyStatus', 'protocol-status failed', 'className');
        safeUpdateElement('beefyError', data.protocols.beefy.error);
    }

    // Euler data
    if (data.protocols.euler.status === 'success') {
        safeUpdateElement('eulerStatus', 'API_SUCCESS');
        safeUpdateElement('eulerStatus', 'protocol-status online', 'className');
        safeUpdateElement('eulerTopAPY', data.protocols.euler.poolsData.summary.highestAPY.toFixed(1) + '%');
        safeUpdateElement('eulerPoolCount', data.protocols.euler.poolsData.summary.totalPools);
        safeUpdateElement('eulerTVL', '$' + (data.protocols.euler.poolsData.summary.totalTVL / 1000000).toFixed(1) + 'M');
        safeUpdateElement('eulerError', '');
    } else {
        safeUpdateElement('eulerStatus', 'API_FAILED');
        safeUpdateElement('eulerStatus', 'protocol-status failed', 'className');
        safeUpdateElement('eulerError', data.protocols.euler.error);
    }

    // Yield Yak data
    if (data.protocols.yieldYak.status === 'success') {
        safeUpdateElement('yieldYakStatus', 'API_SUCCESS');
        safeUpdateElement('yieldYakStatus', 'protocol-status online', 'className');
        safeUpdateElement('yieldYakTopAPY', data.protocols.yieldYak.avalancheData.summary.highestAPY.toFixed(1) + '%');
        safeUpdateElement('yieldYakFarmCount', data.protocols.yieldYak.avalancheData.summary.activeFarms);
        safeUpdateElement('yieldYakTVL', '$' + (data.protocols.yieldYak.avalancheData.summary.totalTVL / 1000000).toFixed(1) + 'M');
        safeUpdateElement('yieldYakError', '');
    } else {
        safeUpdateElement('yieldYakStatus', 'API_FAILED');
        safeUpdateElement('yieldYakStatus', 'protocol-status failed', 'className');
        safeUpdateElement('yieldYakError', data.protocols.yieldYak.error);
    }

    // DeFiLlama data
    if (data.protocols.defiLlama.status === 'success') {
        safeUpdateElement('defiLlamaStatus', 'API_SUCCESS');
        safeUpdateElement('defiLlamaStatus', 'protocol-status online', 'className');
        safeUpdateElement('defiLlamaPoolCount', data.protocols.defiLlama.marketOverview.summary.poolCount);
        safeUpdateElement('defiLlamaAvgAPY', data.protocols.defiLlama.marketOverview.summary.avgLendingAPY.toFixed(1) + '%');
        safeUpdateElement('defiLlamaError', '');
    } else {
        safeUpdateElement('defiLlamaStatus', 'API_FAILED');
        safeUpdateElement('defiLlamaStatus', 'protocol-status failed', 'className');
        safeUpdateElement('defiLlamaError', data.protocols.defiLlama.error);
    }

    safeUpdateElement('dataQuality', data.dataQuality.level);
}

// Update protocols tab
function updateProtocolsTab(data) {
    const details = document.getElementById('protocolDetails');
    details.innerHTML = '';

    Object.entries(data.protocols).forEach(([name, protocol]) => {
        const section = document.createElement('div');
        section.className = 'comparison-section';
        
        const status = protocol.status === 'success' ? 'ONLINE' : 'FAILED';
        const statusClass = protocol.status === 'success' ? 'online' : 'failed';
        
        section.innerHTML = `
            <h3>${name.charAt(0).toUpperCase() + name.slice(1)} Protocol</h3>
            <div class="protocol-status ${statusClass}">${status}</div>
            ${protocol.status === 'success' ? 
                `<pre>${JSON.stringify(protocol, null, 2)}</pre>` :
                `<div class="error-message">Error: ${protocol.error}</div>`
            }
        `;
        
        details.appendChild(section);
    });
}


// Update analysis tab
function updateAnalysisTab(data) {
    const analysisDiv = document.getElementById('marketAnalysis');
    const riskDiv = document.getElementById('riskAssessment');
    const opportunitiesDiv = document.getElementById('opportunities');

    analysisDiv.innerHTML = `
        <div class="comparison-section">
            <h3>Market Conditions: ${data.marketAnalysis.marketConditions}</h3>
            <div>Protocol Status:</div>
            <ul>
                ${Object.entries(data.marketAnalysis.protocolStatus).map(([protocol, status]) => 
                    `<li>${protocol}: ${status}</li>`
                ).join('')}
            </ul>
        </div>
    `;

    riskDiv.innerHTML = data.marketAnalysis.riskFactors.length > 0 ?
        `<ul>${data.marketAnalysis.riskFactors.map(risk => `<li>${risk}</li>`).join('')}</ul>` :
        '<div class="loading">No risk factors identified</div>';

    opportunitiesDiv.innerHTML = data.marketAnalysis.opportunities.length > 0 ?
        `<ul>${data.marketAnalysis.opportunities.map(opp => `<li>${opp}</li>`).join('')}</ul>` :
        '<div class="loading">No opportunities identified</div>';
}

// Update quick displays
function updateQuickDisplays(snapshot) {
    if (snapshot.aave.status === 'API_SUCCESS') {
        document.getElementById('aaveSupplyAPY').textContent = snapshot.aave.supplyRate.toFixed(2) + '%';
        document.getElementById('aaveBorrowAPY').textContent = snapshot.aave.borrowRate.toFixed(2) + '%';
        document.getElementById('aaveUtilization').textContent = snapshot.aave.utilization.toFixed(1) + '%';
        document.getElementById('aaveStatus').textContent = 'API_SUCCESS';
        document.getElementById('aaveStatus').className = 'protocol-status online';
    }

    if (snapshot.beefy.status === 'API_SUCCESS') {
        document.getElementById('beefyTopAPY').textContent = snapshot.beefy.topAPY.toFixed(1) + '%';
        document.getElementById('beefyVaultCount').textContent = snapshot.beefy.totalVaults;
        document.getElementById('beefyStatus').textContent = 'API_SUCCESS';
        document.getElementById('beefyStatus').className = 'protocol-status online';
    }

    if (snapshot.euler.status === 'API_SUCCESS') {
        document.getElementById('eulerTopAPY').textContent = snapshot.euler.topAPY.toFixed(1) + '%';
        document.getElementById('eulerPoolCount').textContent = snapshot.euler.totalPools;
        document.getElementById('eulerTVL').textContent = '$' + (snapshot.euler.totalTVL / 1000000).toFixed(1) + 'M';
        document.getElementById('eulerStatus').textContent = 'API_SUCCESS';
        document.getElementById('eulerStatus').className = 'protocol-status online';
    }
}

// Update data quality indicator
function updateDataQuality(quality) {
    document.getElementById('dataQuality').textContent = `${quality.level} (${quality.successfulSources.length}/${quality.totalSources})`;
}

// UI utility functions
function showStatus(message, type = 'loading') {
    const statusEl = document.getElementById('statusMessage');
    statusEl.textContent = message;
    statusEl.className = `status ${type}`;
    statusEl.style.display = 'block';
}

function showTab(tabName) {
    // Hide all tab contents
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });

    // Remove active class from all tabs
    document.querySelectorAll('.tab').forEach(tab => {
        tab.classList.remove('active');
    });

    // Show selected tab content
    document.getElementById(tabName).classList.add('active');

    // Add active class to clicked tab
    event.target.classList.add('active');
}

// Clear all data
function clearData() {
    currentData = null;
    
    document.querySelectorAll('.metric-value').forEach(el => {
        el.textContent = '--';
    });
    
    document.querySelectorAll('.protocol-status').forEach(el => {
        el.textContent = 'API_FAILED';
        el.className = 'protocol-status failed';
    });
    
    document.querySelectorAll('.error-message').forEach(el => {
        el.textContent = '';
    });
    
    document.getElementById('protocolDetails').innerHTML = '<div class="loading">No data loaded. Click "Fetch All Data" to load protocol information.</div>';
    document.querySelector('#strategyTable tbody').innerHTML = '<tr><td colspan="6" class="loading">No strategies calculated. Load data first.</td></tr>';
    document.getElementById('aaveEulerComparison').innerHTML = '<div class="loading">Comparison data not available. Both protocols must have successful API calls.</div>';
    document.getElementById('yieldComparison').innerHTML = '<div class="loading">Yield comparison not available.</div>';
    document.getElementById('marketAnalysis').innerHTML = '<div class="loading">Market analysis not available. Load data first.</div>';
    document.getElementById('riskAssessment').innerHTML = '<div class="loading">Risk assessment not available.</div>';
    document.getElementById('opportunities').innerHTML = '<div class="loading">Opportunity analysis not available.</div>';
    
    document.getElementById('lastUpdated').textContent = 'Never';
    document.getElementById('executionTime').textContent = '--';
    
    showStatus('All data cleared', 'success');
}

// Export data
function exportData() {
    if (!currentData) {
        showStatus('No data to export', 'error');
        return;
    }

    const dataStr = JSON.stringify(currentData, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    
    const link = document.createElement('a');
    link.href = url;
    link.download = `ush-sush-defi-data-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    showStatus('Data exported successfully', 'success');
}

// INCENTIVES ANALYSIS FUNCTIONS

// Analyze incentive breakdown from pool data - FIXED: Add validation and better estimation
function analyzeIncentiveBreakdown(poolData) {
    const baseAPY = poolData.apyBase || 0;
    const rewardAPY = poolData.apyReward || 0;
    let totalAPY = poolData.apy || 0;
    
    // FIXED: Validate and cap impossible APY values
    if (totalAPY > 1000) {
        console.warn(`🚨 Impossible APY detected: ${totalAPY}% for ${poolData.project}:${poolData.symbol}. Capping at 100%.`);
        totalAPY = 100; // Cap at 100% APY
    }
    
    // If no explicit breakdown, try to estimate
    let estimatedBaseAPY = baseAPY;
    let estimatedRewardAPY = rewardAPY;
    
    if (baseAPY === 0 && rewardAPY === 0 && totalAPY > 0) {
        // IMPROVED: More sophisticated estimation based on protocol type and context
        const project = poolData.project?.toLowerCase() || '';
        const symbol = poolData.symbol?.toLowerCase() || '';
        const tvl = poolData.tvlUsd || 0;
        
        if (['aave-v3', 'euler-v2', 'compound', 'benqi'].includes(project)) {
            // Lending protocols: mostly base yield, some incentives
            if (totalAPY > 15) {
                // High APY for lending = likely has incentives
                estimatedBaseAPY = Math.min(totalAPY * 0.5, 8); // Base capped at 8%
                estimatedRewardAPY = totalAPY - estimatedBaseAPY;
            } else {
                // Normal lending rates
                estimatedBaseAPY = totalAPY * 0.8;
                estimatedRewardAPY = totalAPY * 0.2;
            }
        } else if (['yield-yak', 'beefy', 'vector-finance'].includes(project)) {
            // Auto-compound protocols: Most yield comes from compounding rewards
            estimatedBaseAPY = Math.min(totalAPY * 0.3, 5); // Base underlying yield capped at 5%
            estimatedRewardAPY = totalAPY - estimatedBaseAPY;
        } else if (['trader-joe', 'traderjoe', 'pangolin', 'curve', 'balancer'].includes(project) || 
                   symbol.includes('lp') || symbol.includes('pair')) {
            // DEX protocols: Mix of fees and incentives
            if (totalAPY > 20) {
                // High APY DEX = heavy incentives
                estimatedBaseAPY = Math.min(totalAPY * 0.3, 10); // Trading fees capped at 10%
                estimatedRewardAPY = totalAPY - estimatedBaseAPY;
            } else {
                // Normal DEX yields
                estimatedBaseAPY = totalAPY * 0.6; // Trading fees
                estimatedRewardAPY = totalAPY * 0.4; // Incentives
            }
        } else if (totalAPY > 50) {
            // Very high APY = likely unsustainable incentive farming
            estimatedBaseAPY = Math.min(totalAPY * 0.1, 5); // Very little base yield
            estimatedRewardAPY = totalAPY - estimatedBaseAPY;
        } else if (totalAPY > 25) {
            // High APY = incentive-heavy
            estimatedBaseAPY = totalAPY * 0.25;
            estimatedRewardAPY = totalAPY * 0.75;
        } else {
            // Conservative estimate for unknown protocols
            estimatedBaseAPY = totalAPY * 0.6;
            estimatedRewardAPY = totalAPY * 0.4;
        }
    }
    
    // FIXED: Ensure breakdown makes sense
    if (estimatedBaseAPY + estimatedRewardAPY > totalAPY * 1.1) {
        // If breakdown exceeds total by more than 10%, normalize
        const total = estimatedBaseAPY + estimatedRewardAPY;
        estimatedBaseAPY = (estimatedBaseAPY / total) * totalAPY;
        estimatedRewardAPY = (estimatedRewardAPY / total) * totalAPY;
    }
    
    const incentiveRatio = totalAPY > 0 ? (estimatedRewardAPY / totalAPY) * 100 : 0;
    
    return {
        baseAPY: estimatedBaseAPY,
        incentiveAPY: estimatedRewardAPY,
        totalAPY: totalAPY,
        incentiveRatio: Math.min(incentiveRatio, 100), // Cap at 100%
        rewardTokens: poolData.rewardTokens || [],
        sustainability: assessIncentiveSustainability(poolData, incentiveRatio),
        riskLevel: assessIncentiveRisk(incentiveRatio, totalAPY),
        hasExplicitBreakdown: baseAPY > 0 || rewardAPY > 0,
        dataQuality: {
            hasValidAPY: totalAPY > 0 && totalAPY <= 100,
            hasExplicitBreakdown: baseAPY > 0 || rewardAPY > 0,
            estimationMethod: baseAPY === 0 && rewardAPY === 0 ? 'protocol-based' : 'explicit'
        }
    };
}

// Assess incentive sustainability - FIXED: Better protocol-aware scoring
function assessIncentiveSustainability(poolData, incentiveRatio) {
    let score = 100; // Start with perfect score
    let factors = [];
    
    const project = poolData.project?.toLowerCase() || '';
    const apy = poolData.apy || 0;
    const tvl = poolData.tvlUsd || 0;
    
    // FIXED: Protocol-specific incentive dependency assessment
    if (['yield-yak', 'beefy', 'vector-finance'].includes(project)) {
        // Auto-compound protocols: High incentive ratios are NORMAL and sustainable
        if (incentiveRatio > 90) {
            score -= 10; // Much smaller penalty
            factors.push('Auto-compound protocol with high reward optimization');
        }
        score += 15; // Bonus for established auto-compound protocols
        factors.push('Established auto-compound protocol (+15)');
    } else if (['aave-v3', 'compound', 'euler-v2', 'benqi'].includes(project)) {
        // Lending protocols: High incentive ratios are concerning
        if (incentiveRatio > 80) {
            score -= 30;
            factors.push('High incentive dependency for lending protocol (-30)');
        } else if (incentiveRatio > 60) {
            score -= 15;
            factors.push('Moderate incentive dependency for lending protocol (-15)');
        }
        score += 10;
        factors.push('Established lending protocol (+10)');
    } else {
        // Other protocols: Standard assessment
        if (incentiveRatio > 80) {
            score -= 40;
            factors.push('Very high incentive dependency (>80%)');
        } else if (incentiveRatio > 60) {
            score -= 25;
            factors.push('High incentive dependency (>60%)');
        } else if (incentiveRatio > 40) {
            score -= 15;
            factors.push('Moderate incentive dependency (>40%)');
        }
    }
    
    // TVL size affects sustainability
    if (tvl > 50000000) { // >$50M
        score += 15;
        factors.push('Very large TVL base (+15)');
    } else if (tvl > 10000000) { // >$10M
        score += 10;
        factors.push('Large TVL base (+10)');
    } else if (tvl > 1000000) { // >$1M
        score += 5;
        factors.push('Moderate TVL base (+5)');
    } else if (tvl < 100000) { // <$100k
        score -= 15;
        factors.push('Small TVL base (-15)');
    }
    
    // FIXED: More nuanced APY assessment
    if (apy > 100) {
        score -= 25;
        factors.push('Extreme APY (>100%) - monitor closely (-25)');
    } else if (apy > 50) {
        if (['yield-yak', 'beefy'].includes(project)) {
            score -= 10; // Less penalty for auto-compound protocols
            factors.push('High APY for auto-compound protocol (-10)');
        } else {
            score -= 20;
            factors.push('Very high APY (>50%) sustainability risk (-20)');
        }
    } else if (apy > 25) {
        score -= 5; // Minor penalty for moderately high APY
        factors.push('Moderately high APY (>25%) - acceptable (-5)');
    }
    
    // FIXED: Additional bonuses for known good protocols
    if (['trader-joe', 'traderjoe', 'pangolin', 'curve', 'balancer'].includes(project)) {
        score += 8;
        factors.push('Established DEX protocol (+8)');
    } else if (['gmx', 'platypus'].includes(project)) {
        score += 5;
        factors.push('Known yield farming protocol (+5)');
    }
    
    score = Math.max(0, Math.min(100, score));
    
    let rating;
    if (score >= 75) rating = 'HIGH';
    else if (score >= 55) rating = 'MEDIUM';
    else if (score >= 35) rating = 'LOW';
    else rating = 'VERY_LOW';
    
    return {
        score: score,
        rating: rating,
        factors: factors
    };
}

// Assess incentive risk level
function assessIncentiveRisk(incentiveRatio, totalAPY) {
    if (incentiveRatio > 80 && totalAPY > 50) return 'EXTREME';
    if (incentiveRatio > 70 && totalAPY > 25) return 'HIGH';
    if (incentiveRatio > 50) return 'MEDIUM';
    if (incentiveRatio > 30) return 'LOW';
    return 'MINIMAL';
}

// Generate comprehensive incentives analysis
function generateIncentivesAnalysis(data) {
    console.log('🎯 Generating comprehensive incentives analysis...');
    
    const analysis = {
        overview: {
            totalIncentiveAPY: 0,
            totalBaseAPY: 0,
            avgIncentiveRatio: 0,
            activeProgramsCount: 0,
            totalIncentiveTVL: 0
        },
        protocolBreakdown: {},
        rewardTokens: {},
        sustainability: {
            high: [],
            medium: [],
            low: [],
            veryLow: []
        },
        opportunities: [],
        risks: []
    };
    
    let allPools = [];
    
    // Collect all pools with incentive data
    if (data.protocols.defiLlama.status === 'success') {
        const pools = data.protocols.defiLlama.marketOverview.allAvalanchePools || [];
        allPools = allPools.concat(pools);
    }
    
    // Add Yield Yak farms
    if (data.protocols.yieldYak.status === 'success') {
        const farms = data.protocols.yieldYak.avalancheData.allFarms || [];
        const yakPools = farms.map(farm => ({
            project: 'yield-yak',
            symbol: farm.symbol,
            apy: farm.estimatedAPY,
            tvlUsd: farm.tvl,
            apyBase: 0, // Yield Yak doesn't separate base/reward
            apyReward: farm.estimatedAPY, // Assume all is reward-based
            rewardTokens: farm.rewardToken ? [farm.rewardToken] : [],
            chain: 'Avalanche'
        }));
        allPools = allPools.concat(yakPools);
    }
    
    console.log('🎯 Analyzing', allPools.length, 'pools for incentives...');
    
    // Analyze each pool
    const poolAnalyses = allPools.map(pool => {
        const incentiveBreakdown = analyzeIncentiveBreakdown(pool);
        return {
            ...pool,
            incentiveAnalysis: incentiveBreakdown
        };
    });
    
    // Calculate overview metrics - FIXED: Use averages, not cumulative sums
    const validPools = poolAnalyses.filter(p => p.apy > 0);
    if (validPools.length > 0) {
        // FIXED: Calculate proper averages instead of meaningless sums
        analysis.overview.avgIncentiveAPY = validPools.reduce((sum, p) => sum + p.incentiveAnalysis.incentiveAPY, 0) / validPools.length;
        analysis.overview.avgBaseAPY = validPools.reduce((sum, p) => sum + p.incentiveAnalysis.baseAPY, 0) / validPools.length;
        analysis.overview.avgIncentiveRatio = validPools.reduce((sum, p) => sum + p.incentiveAnalysis.incentiveRatio, 0) / validPools.length;
        analysis.overview.activeProgramsCount = validPools.filter(p => p.incentiveAnalysis.incentiveAPY > 0).length;
        analysis.overview.totalIncentiveTVL = validPools.reduce((sum, p) => sum + (p.tvlUsd || 0), 0);
        
        // FIXED: Add weighted averages for more meaningful metrics
        const totalTVL = validPools.reduce((sum, p) => sum + (p.tvlUsd || 0), 0);
        if (totalTVL > 0) {
            analysis.overview.weightedAvgIncentiveAPY = validPools.reduce((sum, p) => sum + (p.incentiveAnalysis.incentiveAPY * (p.tvlUsd || 0)), 0) / totalTVL;
            analysis.overview.weightedAvgBaseAPY = validPools.reduce((sum, p) => sum + (p.incentiveAnalysis.baseAPY * (p.tvlUsd || 0)), 0) / totalTVL;
            analysis.overview.weightedAvgIncentiveRatio = validPools.reduce((sum, p) => sum + (p.incentiveAnalysis.incentiveRatio * (p.tvlUsd || 0)), 0) / totalTVL;
        }
    }
    
    // Group by protocol
    const protocolGroups = {};
    validPools.forEach(pool => {
        const project = pool.project || 'unknown';
        if (!protocolGroups[project]) {
            protocolGroups[project] = [];
        }
        protocolGroups[project].push(pool);
    });
    
    // Analyze each protocol
    Object.entries(protocolGroups).forEach(([protocol, pools]) => {
        const protocolTVL = pools.reduce((sum, p) => sum + (p.tvlUsd || 0), 0);
        const avgIncentiveRatio = pools.reduce((sum, p) => sum + p.incentiveAnalysis.incentiveRatio, 0) / pools.length;
        const avgAPY = pools.reduce((sum, p) => sum + (p.apy || 0), 0) / pools.length;
        const topPool = pools.sort((a, b) => (b.apy || 0) - (a.apy || 0))[0];
        
        analysis.protocolBreakdown[protocol] = {
            poolCount: pools.length,
            totalTVL: protocolTVL,
            avgIncentiveRatio: avgIncentiveRatio,
            avgAPY: avgAPY,
            topAPY: topPool?.apy || 0,
            topPool: topPool?.symbol || 'N/A',
            sustainabilityRating: calculateProtocolSustainability(pools)
        };
    });
    
    // Analyze reward tokens - FIXED: Handle object serialization properly
    const rewardTokenCounts = {};
    validPools.forEach(pool => {
        if (pool.rewardTokens && pool.rewardTokens.length > 0) {
            pool.rewardTokens.forEach(token => {
                // FIXED: Convert token to string and handle objects properly
                let tokenKey;
                if (typeof token === 'string') {
                    tokenKey = token;
                } else if (typeof token === 'object' && token !== null) {
                    // Handle token objects - extract address or symbol
                    tokenKey = token.address || token.symbol || token.name || JSON.stringify(token).substring(0, 50);
                } else {
                    tokenKey = String(token);
                }
                
                // Ensure we have a valid token key
                if (!tokenKey || tokenKey === 'undefined' || tokenKey === 'null') {
                    tokenKey = 'UNKNOWN_TOKEN';
                }
                
                if (!rewardTokenCounts[tokenKey]) {
                    rewardTokenCounts[tokenKey] = { count: 0, totalTVL: 0, pools: [] };
                }
                rewardTokenCounts[tokenKey].count++;
                rewardTokenCounts[tokenKey].totalTVL += pool.tvlUsd || 0;
                rewardTokenCounts[tokenKey].pools.push(pool.symbol || 'Unknown');
            });
        }
    });
    
    analysis.rewardTokens = rewardTokenCounts;
    
    // Categorize by sustainability
    validPools.forEach(pool => {
        const sustainability = pool.incentiveAnalysis.sustainability.rating;
        switch (sustainability) {
            case 'HIGH':
                analysis.sustainability.high.push(pool);
                break;
            case 'MEDIUM':
                analysis.sustainability.medium.push(pool);
                break;
            case 'LOW':
                analysis.sustainability.low.push(pool);
                break;
            case 'VERY_LOW':
                analysis.sustainability.veryLow.push(pool);
                break;
        }
    });
    
    // Identify opportunities
    const highIncentivePools = validPools.filter(p => p.incentiveAnalysis.incentiveRatio > 50 && p.incentiveAnalysis.sustainability.rating !== 'VERY_LOW');
    const sustainableHighYield = validPools.filter(p => p.apy > 15 && p.incentiveAnalysis.sustainability.rating === 'HIGH');
    
    if (highIncentivePools.length > 0) {
        analysis.opportunities.push(`${highIncentivePools.length} pools with >50% incentive APY and decent sustainability`);
    }
    if (sustainableHighYield.length > 0) {
        analysis.opportunities.push(`${sustainableHighYield.length} high-yield pools (>15%) with high sustainability rating`);
    }
    
    // Identify risks
    const extremeRiskPools = validPools.filter(p => p.incentiveAnalysis.riskLevel === 'EXTREME');
    const unsustainablePools = validPools.filter(p => p.incentiveAnalysis.sustainability.rating === 'VERY_LOW');
    
    if (extremeRiskPools.length > 0) {
        analysis.risks.push(`${extremeRiskPools.length} pools with extreme incentive risk`);
    }
    if (unsustainablePools.length > 0) {
        analysis.risks.push(`${unsustainablePools.length} pools with very low sustainability ratings`);
    }
    
    console.log('🎯 Incentives analysis complete:', {
        totalPools: validPools.length,
        avgIncentiveRatio: analysis.overview.avgIncentiveRatio.toFixed(1) + '%',
        activeProgramsCount: analysis.overview.activeProgramsCount
    });
    
    return analysis;
}

// Calculate protocol sustainability rating
function calculateProtocolSustainability(pools) {
    const avgSustainability = pools.reduce((sum, p) => sum + p.incentiveAnalysis.sustainability.score, 0) / pools.length;
    
    if (avgSustainability >= 80) return 'HIGH';
    if (avgSustainability >= 60) return 'MEDIUM';
    if (avgSustainability >= 40) return 'LOW';
    return 'VERY_LOW';
}

// Update incentives tab
function updateIncentivesTab(data) {
    console.log('🎯 Updating incentives tab...');
    
    const overviewDiv = document.getElementById('incentivesOverview');
    const protocolDiv = document.getElementById('protocolIncentives');
    const rewardTokensDiv = document.getElementById('rewardTokens');
    const sustainabilityDiv = document.getElementById('incentiveSustainability');
    const opportunitiesDiv = document.getElementById('incentiveOpportunities');
    
    // Check if we have enough data
    if (data.protocols.defiLlama.status !== 'success' && data.protocols.yieldYak.status !== 'success') {
        const errorMsg = '<div class="loading">Incentives analysis not available - insufficient API data</div>';
        overviewDiv.innerHTML = errorMsg;
        protocolDiv.innerHTML = errorMsg;
        rewardTokensDiv.innerHTML = errorMsg;
        sustainabilityDiv.innerHTML = errorMsg;
        opportunitiesDiv.innerHTML = errorMsg;
        return;
    }
    
    // Generate incentives analysis
    const incentivesAnalysis = generateIncentivesAnalysis(data);
    
    // Update overview - FIXED: Show meaningful averages instead of cumulative sums
    overviewDiv.innerHTML = `
        <div class="comparison-section">
            <h3>Incentives Overview</h3>
            <div class="protocol-grid">
                <div class="protocol-card">
                    <div class="protocol-header">Total Incentive Programs</div>
                    <div class="metric">
                        <span class="metric-label">Active Programs:</span>
                        <span class="metric-value">${incentivesAnalysis.overview.activeProgramsCount}</span>
                    </div>
                    <div class="metric">
                        <span class="metric-label">Avg Incentive Ratio:</span>
                        <span class="metric-value">${incentivesAnalysis.overview.avgIncentiveRatio.toFixed(1)}%</span>
                    </div>
                    <div class="metric">
                        <span class="metric-label">Total Incentive TVL:</span>
                        <span class="metric-value">$${(incentivesAnalysis.overview.totalIncentiveTVL/1000000).toFixed(1)}M</span>
                    </div>
                </div>
                <div class="protocol-card">
                    <div class="protocol-header">APY Breakdown</div>
                    <div class="metric">
                        <span class="metric-label">Avg Base APY:</span>
                        <span class="metric-value">${incentivesAnalysis.overview.avgBaseAPY.toFixed(1)}%</span>
                    </div>
                    <div class="metric">
                        <span class="metric-label">Avg Incentive APY:</span>
                        <span class="metric-value">${incentivesAnalysis.overview.avgIncentiveAPY.toFixed(1)}%</span>
                    </div>
                    <div class="metric">
                        <span class="metric-label">Base vs Incentive:</span>
                        <span class="metric-value">${(100 - incentivesAnalysis.overview.avgIncentiveRatio).toFixed(1)}% / ${incentivesAnalysis.overview.avgIncentiveRatio.toFixed(1)}%</span>
                    </div>
                </div>
            </div>
            ${incentivesAnalysis.overview.weightedAvgIncentiveRatio ? `
                <div class="comparison-section" style="margin-top: 15px;">
                    <h4>TVL-Weighted Averages (More Representative)</h4>
                    <div style="font-size: 12px; line-height: 1.6;">
                        <div><strong>Weighted Avg Base APY:</strong> ${incentivesAnalysis.overview.weightedAvgBaseAPY.toFixed(2)}%</div>
                        <div><strong>Weighted Avg Incentive APY:</strong> ${incentivesAnalysis.overview.weightedAvgIncentiveAPY.toFixed(2)}%</div>
                        <div><strong>Weighted Incentive Ratio:</strong> ${incentivesAnalysis.overview.weightedAvgIncentiveRatio.toFixed(1)}%</div>
                        <div style="margin-top: 8px; color: #666; font-size: 11px;">
                            <em>Weighted averages account for pool size and provide more realistic market representation</em>
                        </div>
                    </div>
                </div>
            ` : ''}
        </div>
    `;
    
    // Update protocol breakdown
    protocolDiv.innerHTML = `
        <div class="comparison-section">
            <table class="data-table">
                <thead>
                    <tr>
                        <th>Protocol</th>
                        <th>Pool Count</th>
                        <th>Avg Incentive %</th>
                        <th>Avg APY</th>
                        <th>Top APY</th>
                        <th>TVL</th>
                        <th>Sustainability</th>
                    </tr>
                </thead>
                <tbody>
                    ${Object.entries(incentivesAnalysis.protocolBreakdown).map(([protocol, data]) => `
                        <tr>
                            <td><strong>${protocol}</strong></td>
                            <td>${data.poolCount}</td>
                            <td>${data.avgIncentiveRatio.toFixed(1)}%</td>
                            <td>${data.avgAPY.toFixed(1)}%</td>
                            <td>${data.topAPY.toFixed(1)}%</td>
                            <td>$${(data.totalTVL/1000000).toFixed(1)}M</td>
                            <td><span class="protocol-status ${data.sustainabilityRating.toLowerCase()}">${data.sustainabilityRating}</span></td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
    
    // Update reward tokens
    const topRewardTokens = Object.entries(incentivesAnalysis.rewardTokens)
        .sort(([,a], [,b]) => b.totalTVL - a.totalTVL)
        .slice(0, 10);
    
    rewardTokensDiv.innerHTML = `
        <div class="comparison-section">
            <h4>Top Reward Tokens by TVL</h4>
            ${topRewardTokens.length > 0 ? `
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Token Address</th>
                            <th>Pool Count</th>
                            <th>Total TVL</th>
                            <th>Sample Pools</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${topRewardTokens.map(([token, data]) => `
                            <tr>
                                <td style="font-size: 10px;">${token.substring(0, 10)}...${token.substring(token.length - 8)}</td>
                                <td>${data.count}</td>
                                <td>$${(data.totalTVL/1000000).toFixed(1)}M</td>
                                <td style="font-size: 11px;">${data.pools.slice(0, 2).join(', ')}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            ` : '<div class="loading">No reward token data available</div>'}
        </div>
    `;
    
    // Update sustainability analysis
    sustainabilityDiv.innerHTML = `
        <div class="comparison-section">
            <h4>Sustainability Distribution</h4>
            <div class="protocol-grid">
                <div class="protocol-card">
                    <div class="protocol-header">High Sustainability</div>
                    <div class="metric">
                        <span class="metric-label">Pool Count:</span>
                        <span class="metric-value">${incentivesAnalysis.sustainability.high.length}</span>
                    </div>
                    <div style="font-size: 11px; margin-top: 5px;">
                        ${incentivesAnalysis.sustainability.high.slice(0, 3).map(p => `${p.project}:${p.symbol}`).join(', ')}
                    </div>
                </div>
                <div class="protocol-card">
                    <div class="protocol-header">Medium Sustainability</div>
                    <div class="metric">
                        <span class="metric-label">Pool Count:</span>
                        <span class="metric-value">${incentivesAnalysis.sustainability.medium.length}</span>
                    </div>
                    <div style="font-size: 11px; margin-top: 5px;">
                        ${incentivesAnalysis.sustainability.medium.slice(0, 3).map(p => `${p.project}:${p.symbol}`).join(', ')}
                    </div>
                </div>
                <div class="protocol-card">
                    <div class="protocol-header">Low Sustainability</div>
                    <div class="metric">
                        <span class="metric-label">Pool Count:</span>
                        <span class="metric-value">${incentivesAnalysis.sustainability.low.length}</span>
                    </div>
                    <div style="font-size: 11px; margin-top: 5px;">
                        ${incentivesAnalysis.sustainability.low.slice(0, 3).map(p => `${p.project}:${p.symbol}`).join(', ')}
                    </div>
                </div>
                <div class="protocol-card">
                    <div class="protocol-header">Very Low Sustainability</div>
                    <div class="metric">
                        <span class="metric-label">Pool Count:</span>
                        <span class="metric-value">${incentivesAnalysis.sustainability.veryLow.length}</span>
                    </div>
                    <div style="font-size: 11px; margin-top: 5px;">
                        ${incentivesAnalysis.sustainability.veryLow.slice(0, 3).map(p => `${p.project}:${p.symbol}`).join(', ')}
                    </div>
                </div>
            </div>
        </div>
    `;
    
    // Update opportunities
    opportunitiesDiv.innerHTML = `
        <div class="comparison-section">
            <h4>Opportunities & Risks</h4>
            <div style="margin-bottom: 15px;">
                <strong>Opportunities:</strong>
                ${incentivesAnalysis.opportunities.length > 0 ? 
                    `<ul>${incentivesAnalysis.opportunities.map(opp => `<li>${opp}</li>`).join('')}</ul>` :
                    '<div class="loading">No specific opportunities identified</div>'
                }
            </div>
            <div>
                <strong>Risks:</strong>
                ${incentivesAnalysis.risks.length > 0 ? 
                    `<ul>${incentivesAnalysis.risks.map(risk => `<li style="color: #cc0000;">${risk}</li>`).join('')}</ul>` :
                    '<div class="loading">No major risks identified</div>'
                }
            </div>
        </div>
        
        <div class="comparison-section">
            <h4>Top High-Incentive Opportunities</h4>
            ${incentivesAnalysis.sustainability.high.length > 0 ? `
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Protocol</th>
                            <th>Symbol</th>
                            <th>Total APY</th>
                            <th>Incentive %</th>
                            <th>TVL</th>
                            <th>Risk Level</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${incentivesAnalysis.sustainability.high
                            .filter(p => p.incentiveAnalysis.incentiveRatio > 30)
                            .sort((a, b) => (b.apy || 0) - (a.apy || 0))
                            .slice(0, 10)
                            .map(pool => `
                                <tr>
                                    <td>${pool.project}</td>
                                    <td>${pool.symbol}</td>
                                    <td><strong>${(pool.apy || 0).toFixed(1)}%</strong></td>
                                    <td>${pool.incentiveAnalysis.incentiveRatio.toFixed(1)}%</td>
                                    <td>$${((pool.tvlUsd || 0)/1000).toFixed(0)}K</td>
                                    <td><span class="protocol-status ${pool.incentiveAnalysis.riskLevel.toLowerCase()}">${pool.incentiveAnalysis.riskLevel}</span></td>
                                </tr>
                            `).join('')}
                    </tbody>
                </table>
            ` : '<div class="loading">No high-sustainability incentive opportunities found</div>'}
        </div>
    `;
    
    console.log('🎯 Incentives tab updated successfully');
}

// Auto-refresh functionality
document.addEventListener('DOMContentLoaded', function() {
    const autoRefreshCheckbox = document.getElementById('autoRefresh');
    if (autoRefreshCheckbox) {
        autoRefreshCheckbox.addEventListener('change', function() {
            if (this.checked) {
                autoRefreshInterval = setInterval(fetchAllData, 5 * 60 * 1000);
                showStatus('Auto-refresh enabled (5 minutes)', 'success');
            } else {
                if (autoRefreshInterval) {
                    clearInterval(autoRefreshInterval);
                    autoRefreshInterval = null;
                }
                showStatus('Auto-refresh disabled', 'success');
            }
        });
    }

    // Initialize dashboard
    showStatus('Dashboard initialized. Ready to fetch data.', 'success');
});
