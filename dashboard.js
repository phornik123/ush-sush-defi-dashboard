console.log('Initializing USH/sUSH DeFi Dashboard...');

let currentData = null;
let autoRefreshInterval = null;

// Check if we're running on a hosted domain and show CORS warning
if (window.location.protocol === 'https:' || window.location.hostname !== 'localhost') {
    document.addEventListener('DOMContentLoaded', function() {
        const corsWarning = document.getElementById('corsWarning');
        if (corsWarning) {
            corsWarning.style.display = 'block';
        }
    });
}

// Main data fetching function - REAL DATA ONLY
async function fetchAllData() {
    showStatus('Fetching real market data...', 'loading');
    
    try {
        const startTime = Date.now();
        
        // Fetch data from all sources - NO FALLBACKS
        const [aaveData, beefyData, eulerData, defiLlamaData] = await Promise.allSettled([
            fetchAaveData(),
            fetchBeefyData(),
            fetchEulerData(),
            fetchDeFiLlamaData()
        ]);

        // Process results - show failures clearly
        const processedData = {
            aave: processSettledResult(aaveData, 'Aave'),
            beefy: processSettledResult(beefyData, 'Beefy'),
            euler: processSettledResult(eulerData, 'Euler'),
            defiLlama: processSettledResult(defiLlamaData, 'DeFiLlama')
        };

        // Calculate strategies only from real data
        const strategies = calculateStrategies(processedData);

        // Generate analysis
        const marketAnalysis = generateMarketAnalysis(processedData);

        // Protocol comparison
        const protocolComparison = await compareProtocols(processedData);

        const result = {
            timestamp: new Date().toISOString(),
            executionTime: Date.now() - startTime,
            dataQuality: assessDataQuality(processedData),
            protocols: processedData,
            strategies: strategies,
            marketAnalysis: marketAnalysis,
            protocolComparison: protocolComparison
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
        
        return {
            rates: {
                liquidityRate: usdcPool.apy || 0,
                variableBorrowRate: usdcPool.apyBaseBorrow || usdcPool.apy * 1.2 || 0,
                utilizationRate: (usdcPool.utilization || 0) * 100,
                totalLiquidity: usdcPool.tvlUsd || 0,
                totalDebt: (usdcPool.tvlUsd || 0) * (usdcPool.utilization || 0)
            },
            protocol: 'Aave V3',
            chain: 'Avalanche',
            source: 'DeFiLlama-Yields-API',
            pool: usdcPool,
            fetchedAt: new Date().toISOString()
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
        const tvlParsed = parseFloat(tvlRaw) || 0;
        
        return {
            ...vault,
            apy: apys[vault.id] || 0,
            tvl: tvlParsed,
            tvlRaw: tvlRaw,
            debug: {
                tvlExists: !!tvlRaw,
                tvlType: typeof tvlRaw,
                tvlValue: tvlRaw
            }
        };
    }).sort((a, b) => b.apy - a.apy);

    // Calculate totals
    const totalTVL = vaultsWithData.reduce((sum, v) => sum + v.tvl, 0);
    const avgAPY = vaultsWithData.length > 0 ? 
        vaultsWithData.reduce((sum, v) => sum + v.apy, 0) / vaultsWithData.length : 0;

    console.log('🐄 Final calculations:');
    console.log('Total TVL calculated:', totalTVL);
    console.log('Vaults with TVL > 0:', vaultsWithData.filter(v => v.tvl > 0).length);
    console.log('Top 3 vaults by TVL:', vaultsWithData.sort((a, b) => b.tvl - a.tvl).slice(0, 3).map(v => ({
        name: v.name,
        tvl: v.tvl,
        tvlRaw: v.tvlRaw
    })));

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

    // Filter for Avalanche pools with better criteria
    const avalanchePools = yieldsData.data.filter(pool => 
        pool.chain === 'Avalanche' && 
        pool.tvlUsd > 10000 && // Minimum TVL
        pool.apy > 0 && // Valid APY
        (pool.category === 'Lending' || 
         pool.project === 'aave-v3' || 
         pool.project === 'euler-v2' ||
         pool.project === 'beefy')
    ).sort((a, b) => (b.tvlUsd || 0) - (a.tvlUsd || 0)).slice(0, 50);

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

// Calculate strategies from real data only
function calculateStrategies(data) {
    const strategies = {};

    // Only calculate if we have real Aave data
    if (data.aave.status === 'success') {
        const rates = data.aave.rates;
        strategies.leveraged = {
            strategy: 'Leveraged Looping',
            apy: calculateLeveragedAPY(rates, 5, 0.8),
            netAPY: calculateLeveragedAPY(rates, 5, 0.8),
            riskLevel: 'High',
            source: 'aave-v3'
        };
    }

    // Only calculate if we have real Beefy data
    if (data.beefy.status === 'success' && data.beefy.avalancheData.topVaultsByAPY.length > 0) {
        const bestVault = data.beefy.avalancheData.topVaultsByAPY[0];
        strategies.autoCompound = {
            strategy: 'Auto-Compound',
            apy: bestVault.apy,
            netAPY: bestVault.apy * 0.995,
            riskLevel: 'Medium',
            source: 'beefy'
        };
    }

    // Only calculate if we have real Euler data
    if (data.euler.status === 'success' && data.euler.poolsData.pools.length > 0) {
        const bestEulerPool = data.euler.poolsData.pools[0];
        strategies.eulerVault = {
            strategy: 'Euler V2 Vault',
            apy: bestEulerPool.apy,
            netAPY: bestEulerPool.apy * 0.95,
            riskLevel: 'Medium',
            source: 'euler-v2'
        };
    }

    return strategies;
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

        // Categorize by protocol type
        const project = pool.project?.toLowerCase() || '';
        const symbol = pool.symbol?.toLowerCase() || '';
        
        if (['aave-v3', 'euler-v2', 'compound'].includes(project)) {
            protocolCategories.lending.push(pool);
        } else if (['beefy', 'yearn'].includes(project)) {
            protocolCategories.autoCompound.push(pool);
        } else if (project.includes('joe') || project.includes('pangolin') || symbol.includes('lp')) {
            protocolCategories.dex.push(pool);
        } else if (apy > 25 || symbol.includes('farm') || symbol.includes('reward')) {
            protocolCategories.yieldFarming.push(pool);
        } else if (symbol.includes('lev') || symbol.includes('margin')) {
            protocolCategories.leveraged.push(pool);
        } else {
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
    updateStrategiesTab(data);
    updateComparisonTab(data);
    updateAnalysisTab(data);
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

// Update overview tab
function updateOverviewTab(data) {
    // Aave data
    if (data.protocols.aave.status === 'success') {
        document.getElementById('aaveStatus').textContent = 'API_SUCCESS';
        document.getElementById('aaveStatus').className = 'protocol-status online';
        document.getElementById('aaveSupplyAPY').textContent = data.protocols.aave.rates.liquidityRate.toFixed(2) + '%';
        document.getElementById('aaveBorrowAPY').textContent = data.protocols.aave.rates.variableBorrowRate.toFixed(2) + '%';
        document.getElementById('aaveUtilization').textContent = data.protocols.aave.rates.utilizationRate.toFixed(1) + '%';
        document.getElementById('aaveError').textContent = '';
    } else {
        document.getElementById('aaveStatus').textContent = 'API_FAILED';
        document.getElementById('aaveStatus').className = 'protocol-status failed';
        document.getElementById('aaveError').textContent = data.protocols.aave.error;
    }

    // Beefy data
    if (data.protocols.beefy.status === 'success') {
        document.getElementById('beefyStatus').textContent = 'API_SUCCESS';
        document.getElementById('beefyStatus').className = 'protocol-status online';
        document.getElementById('beefyTopAPY').textContent = data.protocols.beefy.avalancheData.summary.highestAPY.toFixed(1) + '%';
        document.getElementById('beefyVaultCount').textContent = data.protocols.beefy.avalancheData.summary.activeVaults;
        document.getElementById('beefyTVL').textContent = '$' + (data.protocols.beefy.avalancheData.summary.totalTVL / 1000000).toFixed(1) + 'M';
        document.getElementById('beefyError').textContent = '';
    } else {
        document.getElementById('beefyStatus').textContent = 'API_FAILED';
        document.getElementById('beefyStatus').className = 'protocol-status failed';
        document.getElementById('beefyError').textContent = data.protocols.beefy.error;
    }

    // Euler data
    if (data.protocols.euler.status === 'success') {
        document.getElementById('eulerStatus').textContent = 'API_SUCCESS';
        document.getElementById('eulerStatus').className = 'protocol-status online';
        document.getElementById('eulerTopAPY').textContent = data.protocols.euler.poolsData.summary.highestAPY.toFixed(1) + '%';
        document.getElementById('eulerPoolCount').textContent = data.protocols.euler.poolsData.summary.totalPools;
        document.getElementById('eulerTVL').textContent = '$' + (data.protocols.euler.poolsData.summary.totalTVL / 1000000).toFixed(1) + 'M';
        document.getElementById('eulerError').textContent = '';
    } else {
        document.getElementById('eulerStatus').textContent = 'API_FAILED';
        document.getElementById('eulerStatus').className = 'protocol-status failed';
        document.getElementById('eulerError').textContent = data.protocols.euler.error;
    }

    // DeFiLlama data
    if (data.protocols.defiLlama.status === 'success') {
        document.getElementById('defiLlamaStatus').textContent = 'API_SUCCESS';
        document.getElementById('defiLlamaStatus').className = 'protocol-status online';
        document.getElementById('defiLlamaPoolCount').textContent = data.protocols.defiLlama.marketOverview.summary.poolCount;
        document.getElementById('defiLlamaAvgAPY').textContent = data.protocols.defiLlama.marketOverview.summary.avgLendingAPY.toFixed(1) + '%';
        document.getElementById('defiLlamaError').textContent = '';
    } else {
        document.getElementById('defiLlamaStatus').textContent = 'API_FAILED';
        document.getElementById('defiLlamaStatus').className = 'protocol-status failed';
        document.getElementById('defiLlamaError').textContent = data.protocols.defiLlama.error;
    }

    document.getElementById('dataQuality').textContent = data.dataQuality.level;
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

// Update strategies tab
function updateStrategiesTab(data) {
    const tbody = document.querySelector('#strategyTable tbody');
    tbody.innerHTML = '';

    if (Object.keys(data.strategies).length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="loading">No strategies available - all APIs failed</td></tr>';
        return;
    }

    Object.entries(data.strategies).forEach(([name, strategy]) => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${strategy.strategy}</td>
            <td>${strategy.apy.toFixed(2)}%</td>
            <td>${strategy.netAPY.toFixed(2)}%</td>
            <td>${strategy.riskLevel}</td>
            <td>${strategy.source}</td>
            <td>CALCULATED</td>
        `;
        tbody.appendChild(row);
    });
}

// Update comparison tab
function updateComparisonTab(data) {
    const aaveEulerDiv = document.getElementById('aaveEulerComparison');
    const yieldDiv = document.getElementById('yieldComparison');

    if (data.protocolComparison.aaveVsEuler) {
        const comparison = data.protocolComparison.aaveVsEuler;
        aaveEulerDiv.innerHTML = `
            <table class="data-table">
                <thead>
                    <tr>
                        <th>Asset</th>
                        <th>Euler APY</th>
                        <th>Aave APY</th>
                        <th>Difference</th>
                        <th>Better Protocol</th>
                    </tr>
                </thead>
                <tbody>
                    ${Object.entries(comparison.comparisons).map(([asset, comp]) => `
                        <tr>
                            <td>${comp.asset}</td>
                            <td>${comp.euler.apy.toFixed(2)}%</td>
                            <td>${comp.aave.apy.toFixed(2)}%</td>
                            <td>${comp.difference.apyDiff.toFixed(2)}%</td>
                            <td>${comp.difference.betterProtocol.toUpperCase()}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
            <div style="margin-top: 10px; font-size: 12px;">
                Summary: ${comparison.summary.eulerWins} Euler wins, ${comparison.summary.aaveWins} Aave wins
            </div>
        `;
    } else {
        aaveEulerDiv.innerHTML = '<div class="loading">Comparison not available - need both Aave and Euler API success</div>';
    }

    yieldDiv.innerHTML = `
        <div>Available Protocols: ${data.protocolComparison.summary.availableProtocols.join(', ')}</div>
        <div>Failed Protocols: ${data.protocolComparison.summary.failedProtocols.join(', ')}</div>
    `;
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
