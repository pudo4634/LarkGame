// ============================================================
//  Color Game - game.js
//  CSS 3D 骰子（无 PixiJS），支持可控概率
// ========================================================

// -------------- 游戏配置 --------------
const COLORS = [
    { name: 'yellow', label: 'Yellow', hex: '#f5d836' },
    { name: 'white',  label: 'White',  hex: '#f5f0e8' },
    { name: 'pink',   label: 'Pink',   hex: '#ff4d9e' },
    { name: 'blue',   label: 'Blue',   hex: '#2080ff' },
    { name: 'orange', label: 'Orange', hex: '#ff7010' },
    { name: 'green',  label: 'Green',  hex: '#30e070' }
];

let _betAmount = 10;    // 每次点击的筹码价值
let _betQuantity = 'inf' // 投注数量：'inf'=∞(1 份)、10、100
let balance = 0;         // 玩家余额，由 initPlayerData() 初始化
let bets = [0, 0, 0, 0, 0, 0];  // 每种颜色的下注次数
let betAmounts = [0, 0, 0, 0, 0, 0];  // 每种颜色的实际下注总金额
let _lockedBetAmount = null;  // 本局锁定的下注金额（一旦下注后锁定）
let isRolling = false;
let _cleanupTimer = null; // finishRoll 的延迟清理定时器，防止与下次 rollDice 冲突
let gameHistory = [];    // 历史记录数组，最多保存 5 条
let currentTab = 'manual';  // 当前页签：'manual' 或 'auto'

// 自动游戏状态
let isAutoPlaying = false;        // 是否正在自动游戏
let autoPlayTimer = null;         // 自动游戏定时器
let autoPlayGamesPlayed = 0;      // 已游玩次数
let autoPlayStartBalance = 0;     // 开始自动游戏时的余额
let autoPlayMaxGames = 0;         // 最大游玩次数（0=无限）
let autoPlayTakeProfit = 0;       // 止盈金额
let autoPlayStopLoss = 0;         // 止损金额
let _autoPlayColorIndexes = [];     // 自动游戏选择的颜色索引数组

// 音效
let audioWin = null;
let audioLose = null;
let audioRoll = null;
let audioQuick = null;

/** 初始化音效 */
function initAudio() {
    audioWin = document.getElementById('audio-win');
    audioLose = document.getElementById('audio-lose');
    audioRoll = document.getElementById('audio-roll');
    audioQuick = document.getElementById('audio-quick');
}

/** 播放音效 */
function playSound(audioElement) {
    if (audioElement) {
        audioElement.currentTime = 0;
        audioElement.play().catch(e => {
            console.log('[Audio] Play failed:', e);
        });
    }
}

// ============================================================
//  玩家状态与配置
// ============================================================

/**
 * 玩家付费状态
 * 【注意】实际应由服务端下发，此处暂时使用默认值
 * true = 已付费，false = 未付费
 */
let isRechargeUser = false;
/**
 * 未付费玩家下注配置
 * 【注意】实际应由服务端下发，此处暂时使用默认配置值
 */
let UNRECHARGED_CONFIG = {
    minBetAmount: 10,    // 最小下注金额
    maxBetAmount: 1000,  // 最大下注金额
    maxBetTimes: 6       // 最大下注次数（颜色数量）
};

window.initData = function (minUnitBet, maxUnitBet, balance, isRecharge)
{
    UNRECHARGED_CONFIG.minBetAmount = minUnitBet;
    UNRECHARGED_CONFIG.maxBetAmount = maxUnitBet;
    isRechargeUser = isRecharge;
    initPlayerData({
        initialAmount: balance,
        isRecharge: isRecharge,
        UNRECHARGED_CONFIG
    });
}

/**
 * 当前玩家的下注配置（由 initPlayerData 初始化）
 * @type {{minBetAmount: number, maxBetAmount: number, maxBetTimes: number}}
 */
let betConfig = { ...UNRECHARGED_CONFIG };

/**
 * 计算默认下注金额（玩家资产的 1/10，向下取整到十位）
 * @param {number} balance - 玩家余额
 * @param {number} minBetAmount - 最小下注金额
 * @returns {number} 默认下注金额
 */
function calculateDefaultBetAmount(balance, minBetAmount) {
    // 玩家资产的 1/10，向下取整到十位
    let defaultAmount = Math.floor(balance / 10 / 10) * 10;
    
    // 如果低于最小下注金额，则使用最小值
    if (defaultAmount < minBetAmount) {
        defaultAmount = minBetAmount;
    }
    
    return defaultAmount;
}

/**
 * 初始化玩家数据
 * 【注意】所有参数实际应由服务器下发，此处暂时使用默认值
 * @param {Object} options - 初始化选项
 * @param {number} options.initialAmount - 初始余额，默认 1000
 * @param {boolean} options.isRecharge - 是否已付费，默认 false
 * @param {Object} options.config - 下注配置（可选，不传则根据 isRecharge 自动设置）
 * @param {number} options.config.minBetAmount - 最小下注金额
 * @param {number} options.config.maxBetAmount - 最大下注金额
 * @param {number} options.config.maxBetTimes - 最大下注次数
 */
function initPlayerData(options = {}) {
    const {
        initialAmount = 1000,
        isRecharge = false,
        config
    } = options;
    
    balance = initialAmount;
    isRechargeUser = isRecharge;
    
    // 设置下注配置
    if (config) {
        // 使用自定义配置
        betConfig = { ...config };
    } else {
        // 根据付费状态自动设置配置
        if (isRecharge) {
            // 已付费玩家无限制
            betConfig = {
                minBetAmount: 10,
                maxBetAmount: balance,
                maxBetTimes: Infinity
            };
        } else {
            // 未付费玩家使用限制配置
            betConfig = { ...UNRECHARGED_CONFIG };
        }
    }
    
    // 设置默认下注金额（玩家资产的 1/10，向下取整到十位）
    _betAmount = calculateDefaultBetAmount(balance, betConfig.minBetAmount);
    
    // 重置下注数据
    bets = [0, 0, 0, 0, 0, 0];
    betAmounts = [0, 0, 0, 0, 0, 0];
    
    updateBetAmountDisplay();
    updateUI();
}

/**
 * 获取当前下注配置
 * @returns {{minBetAmount: number, maxBetAmount: number, maxBetTimes: number}}
 */
function getBetConfig() {
    return betConfig;
}

/**
 * 获取最小下注金额
 */
function getMinBet() {
    return getBetConfig().minBetAmount;
}

/**
 * 获取最大下注金额
 */
function getMaxBet() {
    const config = getBetConfig();
    return Math.min(config.maxBetAmount, balance);
}

/**
 * 设置玩家付费状态（测试用）
 * @param {boolean} isRecharge - 是否已付费
 */
function setRechargeStatus(isRecharge) {
    isRechargeUser = isRecharge;
    // 重新计算配置
    if (isRecharge) {
        betConfig = {
            minBetAmount: 10,
            maxBetAmount: balance,
            maxBetTimes: Infinity
        };
    } else {
        betConfig = { ...UNRECHARGED_CONFIG };
    }
    updateUI();
    console.log(`Recharge status: ${isRecharge ? 'Paid' : 'Free'}`);
    console.log('Current config:', betConfig);
}

// 三个骰子的 6 面色顺序（统一相同，标准骰子布局）
// 面顺序：front, back, right, left, top, bottom
// 标准骰子：相对面之和为 7 (1+6, 2+5, 3+4)
const DICE_FACES = [
    [0, 1, 2, 3, 4, 5], // dice0: front=黄色，back=白色，right=粉色，left=蓝色，top=橙色，bottom=绿色
    [0, 1, 2, 3, 4, 5], // dice1: 与 dice0 相同
    [0, 1, 2, 3, 4, 5], // dice2: 与 dice0 相同
];

// 面索引 → 骰子停止时需要旋转到的角度（deg），使该面朝前（朝向相机）
// 让指定面朝上（朝向摄像机）所需旋转的角度
// CSS 中骰子面初始方向：front 朝前 (Z+)，top 朝上 (Y-)，right 朝右 (X+)
// 要让某个面朝上，需要旋转骰子让该面朝向摄像机（Z+ 方向）
const FACE_TARGET_ANGLES = [
    { rx:   0, ry:   0 }, // 0=front  → 不旋转，已经朝摄像机
    { rx:   0, ry: 180 }, // 1=back   → Y 轴旋转 180°，让背面朝摄像机
    { rx:   0, ry: -90 }, // 2=right  → Y 轴旋转 -90°，让右面朝摄像机（CSS 初始是 +90°朝右，需要 -90°才能朝前）
    { rx:   0, ry:  90 }, // 3=left   → Y 轴旋转 +90°，让左面朝摄像机（CSS 初始是 -90°朝左，需要 +90°才能朝前）
    { rx: -90, ry:   0 }, // 4=top    → X 轴旋转 -90°，让顶面朝摄像机（CSS 初始是 +90°朝上，需要 -90°才能朝前）
    { rx:  90, ry:   0 }, // 5=bottom → X 轴旋转 90°，让底面朝摄像机
];

// ============================================================
//  随机概率控制模块
//  代码位置：【BEGIN】随机概率控制 —— 【END】随机概率控制
// ============================================================

/**
 * 【随机概率控制 - 核心逻辑】
 *
 * 修改概率的方式（在浏览器控制台或外部 JS 调用）：
 *
 * 1. 加权随机（让某颜色更容易中奖）：
 *    setDiceProbability({ mode: 'weighted', weights: [2,1,1,1,1,1] });
 *    // 权重：[黄,白,粉,蓝,橙,绿]，默认全为1（均匀）
 *
 * 2. 强制指定结果（测试用）：
 *    setDiceProbability({ mode: 'force', results: [0,0,0] });
 *    // 三个骰子结果强制为 黄色,黄色,黄色
 *
 * 3. 恢复默认（均匀随机）：
 *    setDiceProbability({ mode: 'default' });
 *
 * 4. 高级：完全自定义随机函数
 *    window.customDiceRandom = function() {
 *        // 返回如 [0,2,4] 的数组
 *    };
 */

let _diceProbConfig = { mode: 'default' };

function setDiceProbability(config) {
    _diceProbConfig = config;
}

function weightedRandom(weights) {
    const total = weights.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    for (let i = 0; i < weights.length; i++) {
        r -= weights[i];
        if (r <= 0) return i;
    }
    return weights.length - 1;
}

function rollDiceRandom() {
    const cfg = _diceProbConfig;
    // 模式1：强制指定结果
    if (cfg.mode === 'force') {
        return [...cfg.results];
    }
    // 模式2：加权随机
    if (cfg.mode === 'weighted' && cfg.weights) {
        return [
            weightedRandom(cfg.weights),
            weightedRandom(cfg.weights),
            weightedRandom(cfg.weights),
        ];
    }
    // 模式3：自定义函数（外部提供）
    if (typeof window.customDiceRandom === 'function') {
        return window.customDiceRandom();
    }
    // 默认：均匀随机
    return [
        Math.floor(Math.random() * 6),
        Math.floor(Math.random() * 6),
        Math.floor(Math.random() * 6),
    ];
}

// 【END】随机概率控制

// ============================================================
//  CSS 3D 骰子类
// ============================================================

const DICE_SIZE = 36; // 骰子边长 px

class Dice3D {
    /**
     * @param {HTMLElement} container - 骰子容器（.dice-container）
     * @param {{x:number, y:number}} pos - 骰子初始位置（相对于 machine-wrapper）
     * @param {number} diceIdx - 骰子编号 0/1/2
     */
    constructor(container, pos, diceIdx) {
        this.diceIdx = diceIdx;
        this.size = DICE_SIZE;
        this.phase = 'idle'; // idle | rolling | done
        this.animFrameId = null;

        // 当前旋转角度（deg）
        this.rx = 0;
        this.ry = 0;

        // 目标角度（停止时）
        this.targetRx = 0;
        this.targetRy = 0;  // 大写Y，与 setTarget() 保持一致

        // 创建 DOM 结构
        this.el = this._createDOM(pos);
        container.appendChild(this.el);

        this._render();
    }

    /** 创建骰子 DOM（6 个面 + 阴影） */
    _createDOM(pos) {
        const wrapper = document.createElement('div');
        wrapper.className = 'dice-scene';
        wrapper.style.position = 'absolute';
        wrapper.style.left     = pos.x + 'px';
        wrapper.style.top      = pos.y + 'px';
        wrapper.style.width    = this.size + 'px';
        wrapper.style.height   = this.size + 'px';
        wrapper.style.perspective = '600px';

        // 3D 旋转容器
        const dice = document.createElement('div');
        dice.className = 'dice-3d';
        dice.style.width  = this.size + 'px';
        dice.style.height = this.size + 'px';
        dice.style.position = 'relative';
        dice.style.transformStyle = 'preserve-3d';
        dice.style.transform = 'rotateX(0deg) rotateY(0deg)';

        // 6 个面
        const faceNames = ['front', 'back', 'right', 'left', 'top', 'bottom'];
        const faceOrder = DICE_FACES[this.diceIdx]; // 这个骰子每个面对应哪个颜色
        this._faceEls = [];

        for (let i = 0; i < 6; i++) {
            const colorIdx = faceOrder[i];
            const color = COLORS[colorIdx];
            const face = document.createElement('div');
            face.className = 'dice-face ' + faceNames[i];
            face.style.position = 'absolute';
            face.style.width  = this.size + 'px';
            face.style.height = this.size + 'px';
            face.style.borderRadius = '9px';
            face.style.border = '2px solid rgba(255,255,255,0.25)';
            face.style.display = 'flex';
            face.style.alignItems = 'center';
            face.style.justifyContent = 'center';
            face.style.fontSize = '16px';
            face.style.fontWeight = 'bold';
            face.style.color = 'rgba(0,0,0,0.45)';
            face.style.backgroundColor = color.hex;
            face.style.backfaceVisibility = 'hidden';
            face.style.boxShadow = 'inset 0 0 12px rgba(0,0,0,0.15)';
            dice.appendChild(face);
            this._faceEls[i] = face;
        }

        wrapper.appendChild(dice);
        this._diceEl = dice;

        // 阴影
        const shadow = document.createElement('div');
        shadow.className = 'dice-shadow';
        shadow.style.position = 'absolute';
        shadow.style.left   = (this.size / 2 - this.size * 0.38) + 'px';
        shadow.style.top    = (this.size + this.size * 0.6 - this.size * 0.08) + 'px';
        shadow.style.width  = (this.size * 0.75) + 'px';
        shadow.style.height = (this.size * 0.16) + 'px';
        shadow.style.background = 'rgba(0,0,0,0.18)';
        shadow.style.borderRadius = '50%';
        shadow.style.pointerEvents = 'none';
        shadow.style.opacity = '0';
        wrapper.appendChild(shadow);
        this._shadowEl = shadow;

        return wrapper;
    }

    /** 设置目标结果（哪个颜色朝上/朝前） */
    setTarget(colorIdx) {
        const faceOrder = DICE_FACES[this.diceIdx];
        const faceIdx = faceOrder.indexOf(colorIdx); // 找出该颜色在哪个面上
        const angles = FACE_TARGET_ANGLES[faceIdx];
        // 多加几圈旋转，让动画更自然
        this.targetRx = angles.rx + 360 * (3 + Math.floor(Math.random() * 3));
        this.targetRy = angles.ry + 360 * (2 + Math.floor(Math.random() * 3));
        this._resultColorIdx = colorIdx;
        
        // 调试日志
        console.log(`骰子 ${this.diceIdx}: 目标颜色索引=${colorIdx} (${COLORS[colorIdx].label}), 面索引=${faceIdx}, 旋转角度=(${this.targetRx}, ${this.targetRy})`);
    }

    /** 更新 DOM transform（ immediate，无 transition） */
    _render() {
        this._diceEl.style.transition = 'none';
        this._diceEl.style.transform =
            'rotateX(' + this.rx.toFixed(1) + 'deg) rotateY(' + this.ry.toFixed(1) + 'deg)';
    }

    /** 销毁 */
    destroy() {
        if (this.animFrameId) cancelAnimationFrame(this.animFrameId);
        if (this.el && this.el.parentNode) this.el.parentNode.removeChild(this.el);
        this.el = null;
    }
}

// ============================================================
//  动画控制器
// ============================================================

let activeDice = []; // 当前活动的 3 个 Dice3D 实例
let _animFrameId = null;

function startRollAnimation(results) {
    // 取消之前的动画循环，防止多个动画互相干扰导致骰子消失
    if (_animFrameId) {
        cancelAnimationFrame(_animFrameId);
        _animFrameId = null;
    }

    // 取消残留的清理定时器，防止误销毁新骰子
    if (_cleanupTimer) {
        clearTimeout(_cleanupTimer);
        _cleanupTimer = null;
    }

    const container = document.getElementById('diceContainer');

    // 三个骰子的初始位置（相对于 machine-wrapper 314×499）
    const dicePositions = [
        { x: 58,  y: 125 },
        { x: 136, y: 125 },
        { x: 214, y: 125 },
    ];
    const endY = 270; // 停止时的 Y 位置

    const t0 = performance.now();

    // 创建骰子实例
    activeDice = results.map((colorIdx, i) => {
        const d = new Dice3D(container, dicePositions[i], i);
        d.setTarget(colorIdx);
        d._endY   = endY;
        d._startY = dicePositions[i].y;
        d._phase  = 'waiting';
        d._delay  = i * 150;       // 错开启动（加快）
        d._duration = 1200 + i * 200; // 总时长 ms（加快）
        return d;
    });

    function tick() {
        const now = performance.now();
        let allDone = true;

        for (let i = 0; i < activeDice.length; i++) {
            const d = activeDice[i];
            if (d._phase === 'done') continue;
            allDone = false;

            const diceStartTime = t0 + d._delay;
            if (now < diceStartTime) continue;

            if (d._phase === 'waiting') {
                d._phase = 'rolling';
                d._tStart = now;
            }

            const elapsed  = now - d._tStart;
            const progress = Math.min(elapsed / d._duration, 1);

            if (progress < 0.75) {
                // 阶段 1：快速旋转 + 下落（加快旋转速度）
                const p = progress / 0.75;
                const spinFactor = 1 - p * 0.65;

                d.rx += (0.35 + Math.sin(p * 10) * 0.08) * spinFactor * 360 / 60;
                d.ry += (0.28 + Math.cos(p * 8) * 0.06) * spinFactor * 360 / 60;

                // 下落
                const yEase = p * p;
                const currentY = d._startY + (d._endY - d._startY) * yEase;
                d.el.style.top = currentY + 'px';

                // 阴影
                d._shadowEl.style.opacity = Math.min(p * 2.5, 0.55).toString();

                d._render();

            } else {
                // 阶段2：减速对齐到目标角度
                const alignP = (progress - 0.75) / 0.25;
                const ease = 1 - Math.pow(1 - alignP, 3);

                d.rx = lerpAngleDeg(d.rx, d.targetRx, ease * 0.15);
                d.ry = lerpAngleDeg(d.ry, d.targetRy, ease * 0.15);

                d.el.style.top = d._endY + 'px';
                d._shadowEl.style.opacity = '0.55';

                // 弹跳效果
                if (alignP < 0.65) {
                    const bounce = -5 * Math.sin(alignP / 0.65 * Math.PI);
                    d.el.style.top = (d._endY + bounce) + 'px';
                }

                d._render();
            }

            // 完成检测
            if (progress >= 1 && d._phase !== 'done') {
                d._phase = 'done';
                d.rx = d.targetRx % 360;
                d.ry = d.targetRy % 360;
                d._render();
                
                // 调试：打印最终角度
                console.log(`骰子 ${d.diceIdx} 停止：最终角度=(${d.rx}, ${d.ry}), 目标颜色=${d._resultColorIdx} (${COLORS[d._resultColorIdx].label})`);
            }
        }

        // forEach 结束后，统一判断是否继续动画
        if (!allDone) {
            _animFrameId = requestAnimationFrame(tick);
        } else {
            _animFrameId = null;
            // 所有骰子停止后，多等 1200ms 让弹跳收尾，再出结果
            setTimeout(() => finishRoll(results), 1200);
        }
    }

    _animFrameId = requestAnimationFrame(tick);
}

/** 角度最短路径插值（deg） */
function lerpAngleDeg(a, b, t) {
    let diff = b - a;
    while (diff > 180)  diff -= 360;
    while (diff < -180) diff += 360;
    return a + diff * t;
}

// ============================================================
//  投注控制（金额 + 投注数量）
// ============================================================

/** 更新金额显示 */
function updateBetAmountDisplay() {
    const input = document.getElementById('betAmountInput');
    if (input) input.value = _betAmount;
}

/** 设置投注金额 */
function setBetAmount(val) {
    const config = getBetConfig();
    
    // 检查最小金额限制
    if (val < config.minBetAmount) {
        val = config.minBetAmount;
        if (!isRechargeUser) {
            showToast(`The minimum bet amount for un recharge user is ${config.minBetAmount}`);
        }
    }
    
    // 检查最大金额限制
    if (val > config.maxBetAmount) {
        val = config.maxBetAmount;
        if (!isRechargeUser) {
            showToast(`The maximum bet amount for un recharge user is ${config.maxBetAmount}`);
        }
    }
    
    _betAmount = val;
    updateBetAmountDisplay();
    // 高亮选中的快捷按钮
    document.querySelectorAll('.quick-btn').forEach(b => {
        b.classList.toggle('active', parseInt(b.dataset.amt) === val);
    });
}

/** 显示 Toast 提示 */
function showToast(message) {
    // 创建 Toast 元素（如果不存在）
    let toast = document.getElementById('toast-message');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toast-message';
        toast.style.position = 'fixed';
        toast.style.bottom = '80px';
        toast.style.left = '50%';
        toast.style.transform = 'translateX(-50%)';
        toast.style.background = 'rgba(0,0,0,0.85)';
        toast.style.color = '#fff';
        toast.style.padding = '12px 24px';
        toast.style.borderRadius = '8px';
        toast.style.fontSize = '12px';
        toast.style.zIndex = '9999';
        toast.style.whiteSpace = 'nowrap';
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s';
        document.body.appendChild(toast);
    }
    
    toast.textContent = message;
    toast.style.opacity = '1';
    
    // 3 秒后自动消失
    setTimeout(() => {
        toast.style.opacity = '0';
    }, 3000);
}

/** 触发中奖格子闪烁效果 */
function triggerWinFlash(winningColors) {
    // winningColors: 中奖且有下注的颜色索引数组
    if (!winningColors || winningColors.length === 0) return;
    
    winningColors.forEach(colorIndex => {
        const colorBtn = document.querySelector(`.color-btn[data-index="${colorIndex}"]`);
        if (colorBtn) {
            colorBtn.classList.add('win-flash');
            
            // 动画结束后移除类（0.3s * 5 次 = 1.5s）
            setTimeout(() => {
                colorBtn.classList.remove('win-flash');
            }, 1500);
        }
    });
}

/** 拖动条状态 */
let _sliderVisible = false;

/** 输入框输入时处理（只允许整数） */
function onBetAmountInput(input) {
    // 只保留数字，遇到小数点就停止
    const value = input.value.split('.')[0].replace(/\D/g, '');
    input.value = value;
}

/** 输入框失焦时处理（验证最大最小值） */
function onBetAmountBlur(input) {
    const config = getBetConfig();
    let value = parseInt(input.value) || 0;
    
    // 未付费玩家输入低于最小值
    if (!isRechargeUser && value < config.minBetAmount) {
        value = config.minBetAmount;
        showToast(`The minimum bet amount for un recharge user is ${config.minBetAmount}`);
        setBetAmount(value);
        updateSliderPosition();
        closeMaxBetTip();
        return;
    }
    
    // 未付费玩家输入高于最大值
    if (!isRechargeUser && value > config.maxBetAmount) {
        value = config.maxBetAmount;
        showToast(`The maximum bet amount for un recharge user is ${config.maxBetAmount}`);
        setBetAmount(value);
        updateSliderPosition();
        closeMaxBetTip();
        return;
    }
    
    // 验证最小值
    if (value < config.minBetAmount) {
        value = config.minBetAmount;
        if (!isRechargeUser) {
            showToast(`Min bet: ${config.minBetAmount}`);
        }
    }
    
    // 验证最大值
    if (value > config.maxBetAmount) {
        value = config.maxBetAmount;
        if (!isRechargeUser) {
            showToast(`Max bet: ${config.maxBetAmount}`);
        }
    }
    
    // 验证余额
    if (value > balance) {
        value = balance;
        showToast('Insufficient balance.');
    }
    
    // 向下取整到十位
    value = Math.floor(value / 10) * 10;
    
    // 确保不低于最小值
    if (value < config.minBetAmount) {
        value = config.minBetAmount;
    }
    
    setBetAmount(value);
    updateSliderPosition();
    
    // 关闭 Max Bet 提示
    closeMaxBetTip();
}

/** 切换 Max Bet 提示显示 */
function toggleMaxBetTip(event) {
    if (event) {
        event.stopPropagation();
    }
    
    const tooltip = document.getElementById('maxBetTooltip');
    if (tooltip) {
        const isVisible = tooltip.style.display !== 'none';
        if (isVisible) {
            closeMaxBetTip();
        } else {
            showMaxBetTip();
        }
    }
}

/** 显示 Max Bet 提示 */
function showMaxBetTip() {
    const tooltip = document.getElementById('maxBetTooltip');
    const maxBetValue = document.getElementById('maxBetValue');
    
    if (tooltip && maxBetValue) {
        const config = getBetConfig();
        maxBetValue.textContent = config.maxBetAmount.toFixed(2);
        tooltip.style.display = 'block';
    }
}

/** 关闭 Max Bet 提示 */
function closeMaxBetTip() {
    const tooltip = document.getElementById('maxBetTooltip');
    if (tooltip) {
        tooltip.style.display = 'none';
    }
}

/** 点击任意按钮关闭 Max Bet 提示 */
function setupMaxBetTipCloseHandler() {
    document.addEventListener('click', function(event) {
        // 检查是否点击在按钮上
        if (event.target.tagName === 'BUTTON') {
            closeMaxBetTip();
        }
    });
}

// 初始化时设置关闭处理器
setupMaxBetTipCloseHandler();

/** 切换拖动条显示/隐藏 */
function toggleSlider() {
    const config = getBetConfig();

    // 未付费玩家不能拖动
    if (!isRechargeUser) {
        showToast(`The minimum bet amount for un recharge user is ${config.minBetAmount}`);
        return;
    }

    _sliderVisible = !_sliderVisible;
    const slider = document.getElementById('betSlider');
    if (slider) {
        slider.style.display = _sliderVisible ? 'block' : 'none';
    }

    // 如果展开，等 DOM 渲染后再更新范围和位置
    if (_sliderVisible) {
        requestAnimationFrame(() => {
            updateSliderRange();
            // 强制浏览器回流，确保 min/max 生效后再设值
            const s = document.getElementById('betSliderInput');
            if (s) void s.offsetHeight;
            updateSliderPosition();
        });
    }
}

/** 更新拖动条的范围（min/max） */
function updateSliderRange() {
    const config = getBetConfig();
    const slider = document.getElementById('betSliderInput');
    const sliderMinLabel = document.getElementById('sliderMin');
    const sliderMaxLabel = document.getElementById('sliderMax');
    
    if (slider) {
        slider.min = config.minBetAmount;
        slider.max = Math.min(config.maxBetAmount, balance);
        slider.step = 10;
        
        // 更新标签
        if (sliderMinLabel) sliderMinLabel.textContent = `Min: ${config.minBetAmount}`;
        if (sliderMaxLabel) sliderMaxLabel.textContent = `Max: ${Math.min(config.maxBetAmount, balance)}`;
    }
}

/** 更新拖动条位置 */
function updateSliderPosition() {
    const slider = document.getElementById('betSliderInput');
    if (slider) {
        slider.value = _betAmount;
        updateSliderBackground(slider.value);
    }
}

/** 更新滑块背景渐变 */
function updateSliderBackground(value) {
    const slider = document.getElementById('betSliderInput');
    if (slider) {
        const min = parseInt(slider.min) || 10;
        const max = parseInt(slider.max) || 1000;
        const percentage = ((value - min) / (max - min)) * 100;
        slider.style.setProperty('--slider-position', percentage + '%');
    }
}

/** 拖动条变化处理 */
function onSliderChange(value) {
    const config = getBetConfig();
    let newVal = parseInt(value);
    
    // 确保在限制范围内
    newVal = Math.max(config.minBetAmount, Math.min(config.maxBetAmount, newVal));
    
    setBetAmount(newVal);
    updateSliderBackground(newVal);
}

/** 设置滑块到最小值 */
function setSliderToMin() {
    const config = getBetConfig();
    const slider = document.getElementById('betSliderInput');
    if (slider) {
        slider.value = config.minBetAmount;
        setBetAmount(config.minBetAmount);
        updateSliderBackground(config.minBetAmount);
    }
}

/** 设置滑块到最大值 */
function setSliderToMax() {
    const maxBet = getMaxBet();
    const slider = document.getElementById('betSliderInput');
    if (slider) {
        slider.value = maxBet;
        setBetAmount(maxBet);
        updateSliderBackground(maxBet);
    }
}

/** 点击非拖动条区域关闭 */
function setupSliderCloseHandler() {
    document.addEventListener('click', function(event) {
        const slider = document.getElementById('betSlider');
        const arrows = document.querySelectorAll('.arrow-btn');
        
        if (_sliderVisible && slider && !slider.contains(event.target)) {
            // 检查是否点击在箭头上
            let clickedArrow = false;
            arrows.forEach(arrow => {
                if (arrow.contains(event.target)) clickedArrow = true;
            });
            
            if (!clickedArrow) {
                _sliderVisible = false;
                slider.style.display = 'none';
            }
        }
        
        // 点击任意位置关闭 Max Bet 提示
        const tooltip = document.getElementById('maxBetTooltip');
        const infoIcon = document.querySelector('.info-icon');
        if (tooltip && tooltip.style.display !== 'none') {
            if (!tooltip.contains(event.target) && !infoIcon.contains(event.target)) {
                closeMaxBetTip();
            }
        }
    });
}

// 初始化时设置关闭处理器
setupSliderCloseHandler();

/** 调整投注金额（1/2、2×） */
function adjustBetAmount(factor) {
    const config = getBetConfig();
    
    // 未付费玩家禁用所有调整按钮
    if (!isRechargeUser) {
        if (factor === 0.5) {
            showToast(`The minimum bet amount for un recharge user is ${config.minBetAmount}`);
        } else if (factor === 2) {
            showToast(`The maximum bet amount for un recharge user is ${config.maxBetAmount}`);
        }
        return;
    }
    
    let newVal;
    if (factor === 0.5) {
        // 1/2：减半
        newVal = Math.max(config.minBetAmount, Math.round(_betAmount / 2));
    } else if (factor === 2) {
        // 2x：翻倍
        newVal = Math.min(config.maxBetAmount, _betAmount * 2);
    } else {
        return;
    }
    
    // 检查是否超过最大限制
    if (newVal > config.maxBetAmount) {
        newVal = config.maxBetAmount;
        showToast(`Max bet: ${config.maxBetAmount}`);
    }
    
    setBetAmount(newVal);
    
    // 如果拖动条打开，同步更新滑块位置
    if (_sliderVisible) {
        updateSliderPosition();
    }
}

/** 设置投注数量（∞、10、100） */
function setBetQuantity(val) {
    _betQuantity = val;
    document.querySelectorAll('.qty-btn').forEach(b => {
        b.classList.toggle('active', (b.dataset.qty === 'inf' && val === 'inf') || b.dataset.qty == val);
    });
}

// ============================================================
//  游戏逻辑
// ============================================================

/**
 * 添加下注
 * @param {HTMLElement} btn - 颜色按钮
 * @param {number} forceQty - （可选）强制指定的下注数量，用于自动游戏
 * @param {boolean} isAuto - （可选）是否是自动游戏，true 时跳过锁定金额检查
 */
function addBet(btn, forceQty, isAuto) {
    if (isRolling) return;
    
    const config = getBetConfig();
    const idx = parseInt(btn.dataset.index);
    
    // 在自动页签下，记录玩家选择的颜色（支持多选）
    if (currentTab === 'auto' && !isAutoPlaying) {
        // 如果这个颜色已经选中，则取消选中；否则添加选中
        const existingIndex = _autoPlayColorIndexes.indexOf(idx);
        if (existingIndex > -1) {
            _autoPlayColorIndexes.splice(existingIndex, 1);
        } else {
            _autoPlayColorIndexes.push(idx);
        }
        console.log('[addBet] Auto tab: selected color indexes:', _autoPlayColorIndexes, 
                    _autoPlayColorIndexes.map(i => COLORS[i].label));
    }
    
    // 每次下注固定为 1 个筹码（投注数量在自动模式下代表游玩次数）
    const qty = 1;
    const cost = qty * _betAmount;
    
    console.log('[addBet] idx:', idx, 'qty:', qty, '_betAmount:', _betAmount, 'cost:', cost, 'isAuto:', isAuto);
    
    // 检查本局下注金额是否已锁定（自动游戏跳过此检查）
    if (!isAuto && _lockedBetAmount !== null) {
        // 已锁定，必须使用相同的下注金额
        const expectedCost = 1 * _lockedBetAmount;
        
        if (cost !== expectedCost) {
            showToast(`Use same amount for all bets.`);
            return;
        }
    }
    
    // 1.3 下注次数限制检查
    if (!isRechargeUser) {
        // 统计当前已下注的颜色数量
        const betColorsCount = bets.filter(b => b > 0).length;
        // 如果这个颜色还没下注，且已达到最大次数限制
        if (bets[idx] === 0 && betColorsCount >= config.maxBetTimes) {
            showToast(`Your maximum times of bets is ${config.maxBetTimes}`);
            return;
        }
    }
    
    // 余额检查
    if (balance < cost) {
        showHint('Insufficient balance!', 'lose');
        return;
    }
    
    bets[idx] += qty;
    betAmounts[idx] += cost;  // 记录实际下注金额
    
    // 如果是第一次下注，锁定本局下注金额
    if (_lockedBetAmount === null) {
        _lockedBetAmount = _betAmount;
    }
    
    balance -= cost;
    updateUI();
    
    // 在自动页签下，更新选中样式
    if (currentTab === 'auto' && !isAutoPlaying) {
        document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        // 启用高级设置输入框
        updateAdvancedInputsState();
    }
    
    btn.style.transform = 'scale(0.95)';
    setTimeout(() => btn.style.transform = '', 100);
}

function clearAllBets() {
    if (isRolling) return;
    
    // 计算总下注金额
    const totalBet = betAmounts.reduce((a, b) => a + b, 0);
    if (totalBet === 0) return;
    
    // 退还总下注金额
    balance += totalBet;
    
    // 重置下注
    bets = [0, 0, 0, 0, 0, 0];
    betAmounts = [0, 0, 0, 0, 0, 0];
    _lockedBetAmount = null;  // 清除所有下注时重置锁定金额
    
    // 清除选中样式
    document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('selected'));
    
    // 清空高级设置输入框并禁用
    const takeProfitInput = document.getElementById('takeProfitInput');
    const stopLossInput = document.getElementById('stopLossInput');
    if (takeProfitInput) takeProfitInput.value = '';
    if (stopLossInput) stopLossInput.value = '';
    updateAdvancedInputsState();
    
    // 已付费玩家需要更新最大下注金额（因为余额变化了）
    if (isRechargeUser) {
        betConfig.maxBetAmount = balance;
    }
    
    // 重新计算默认下注金额
    const config = getBetConfig();
    _betAmount = calculateDefaultBetAmount(balance, config.minBetAmount);
    updateBetAmountDisplay();
    
    updateUI();
    showHint('All bets cleared', '');
}

/**
 * 更新高级设置输入框的启用/禁用状态
 * 自动页签下，未选择色块时禁用止盈止损输入框
 */
function updateAdvancedInputsState() {
    const takeProfitInput = document.getElementById('takeProfitInput');
    const stopLossInput = document.getElementById('stopLossInput');
    if (!takeProfitInput || !stopLossInput) return;
    
    // 检查是否有色块被选中
    const hasSelectedColor = document.querySelector('.color-btn.selected') !== null;
    
    takeProfitInput.disabled = !hasSelectedColor;
    stopLossInput.disabled = !hasSelectedColor;
    
    // 更新样式
    const opacity = hasSelectedColor ? '1' : '0.4';
    const cursor = hasSelectedColor ? 'text' : 'not-allowed';
    takeProfitInput.style.opacity = opacity;
    takeProfitInput.style.cursor = cursor;
    stopLossInput.style.opacity = opacity;
    stopLossInput.style.cursor = cursor;
}

function updateUI() {
    const config = getBetConfig();
    const totalBet = betAmounts.reduce((a, b) => a + b, 0);
    document.getElementById('balanceDisplay').textContent = balance.toFixed(2);
    document.getElementById('totalBet').textContent = totalBet;
    
    // 更新 Max Bet 显示值
    const maxBetValue = document.getElementById('maxBetValue');
    if (maxBetValue) {
        maxBetValue.textContent = config.maxBetAmount.toFixed(2);
    }

    for (let i = 0; i < 6; i++) {
        const chipStack = document.getElementById('chips-' + i);
        const label     = document.getElementById('label-' + i);
        const btn      = document.querySelector('.color-btn[data-index="' + i + '"]');
        chipStack.innerHTML = '';
        if (betAmounts[i] > 0) {
            const showCount = Math.min(bets[i], 8);
            for (let c = 0; c < showCount; c++) {
                const chip = document.createElement('div');
                chip.className = 'chip';
                if (c === showCount - 1 && bets[i] > 1) {
                    chip.textContent = bets[i];
                    chip.style.fontSize = bets[i] >= 100 ? '8px' : bets[i] >= 10 ? '9px' : '11px';
                }
                chipStack.appendChild(chip);
            }
            label.textContent = betAmounts[i].toFixed(2);
            label.classList.add('show');
            btn.style.borderColor = 'rgba(255,255,255,0.6)';
        } else {
            label.classList.remove('show');
            btn.style.borderColor = 'transparent';
        }
    }

    const hasBet = bets.some(b => b > 0);
    // 自动游戏时，按钮不应该被 isRolling 禁用，允许随时停止
    // 自动游戏时，即使 bets=0，按钮也不应该被禁用（因为按钮功能是"停止"而不是"开始"）
    const shouldDisableRollBtn = isAutoPlaying ? false : (!hasBet || isRolling);
    document.getElementById('rollBtn').disabled = shouldDisableRollBtn;
    
    // 启用/禁用颜色按钮（只有在滚动时禁用）
    document.querySelectorAll('.color-btn').forEach(b => {
        b.disabled = isRolling;
    });
    
    // 1.2 下注金额限制：未付费玩家禁用快捷按钮
    if (!isRechargeUser) {
        // 禁用 1/2、2x 按钮，但保留 Clear 按钮可用
        document.querySelectorAll('.op-btn').forEach(btn => {
            if (btn.id !== 'clearBtn') {
                btn.disabled = true;
            }
        });
        // 禁用上下箭头按钮
        document.querySelectorAll('.arrow-btn').forEach(btn => {
            btn.disabled = true;
        });
        // 禁用 Min/Max 滑块按钮
        const minBtn = document.getElementById('minBtn');
        const maxBtn = document.getElementById('maxBtn');
        if (minBtn) minBtn.disabled = true;
        if (maxBtn) maxBtn.disabled = true;
        // 禁用 Auto 页签按钮
        const autoTabBtn = document.getElementById('autoTabBtn');
        if (autoTabBtn) autoTabBtn.disabled = true;
        // 隐藏拖动条
        const slider = document.getElementById('betSlider');
        if (slider) slider.style.display = 'none';
        _sliderVisible = false;
    } else {
        // 已付费玩家启用按钮
        document.querySelectorAll('.op-btn').forEach(btn => {
            btn.disabled = false;
        });
        document.querySelectorAll('.arrow-btn').forEach(btn => {
            btn.disabled = false;
        });
        const minBtn = document.getElementById('minBtn');
        const maxBtn = document.getElementById('maxBtn');
        if (minBtn) minBtn.disabled = false;
        if (maxBtn) maxBtn.disabled = false;
        const autoTabBtn = document.getElementById('autoTabBtn');
        if (autoTabBtn) autoTabBtn.disabled = false;
        // 更新拖动条范围
        updateSliderRange();
    }
}

function showHint(text, type) {
    const hint = document.getElementById('hintText');
    hint.textContent = text;
    hint.className = 'hint-text' + (type ? ' ' + type : '');
}

/**
 * 显示胜利结算图层
 * @param {number} totalWin - 总赢利金额
 * @param {number} maxHitCount - 最高命中骰子数 (1/2/3)
 */
function showWinOverlay(totalWin, maxHitCount) {
    const overlay = document.getElementById('winOverlay');
    const multiplierEl = document.getElementById('winMultiplier');
    const amountEl = document.getElementById('winAmount');
    
    // 根据命中骰子数显示对应倍率
    let multiplierText = 'X2';
    if (maxHitCount === 2) {
        multiplierText = 'X3';
    } else if (maxHitCount === 3) {
        multiplierText = 'X16';
    }
    multiplierEl.textContent = multiplierText;
    
    // 设置赢利金额（保留 2 位小数）
    amountEl.textContent = totalWin.toFixed(2);
    
    // 显示图层
    overlay.classList.add('show');
    
    // 2.8 秒后自动隐藏（在下一局开始前消失）
    setTimeout(() => {
        overlay.classList.remove('show');
    }, 2800);
}

/**
 * 添加历史记录
 * @param {number[]} results - 骰子结果数组 [0-5, 0-5, 0-5]
 * @param {number} totalWin - 总赢利金额
 */
function addHistoryRecord(results, totalWin) {
    // 计算本局最高倍率
    let maxMultiplier = 0;
    let hasWin = totalWin > 0;
    
    // 检查所有下注的颜色，找出最高倍率
    for (let ci = 0; ci < 6; ci++) {
        if (betAmounts[ci] === 0) continue;
        const mc = results.filter(r => r === ci).length;
        if (mc === 3) {
            maxMultiplier = 16;
        } else if (mc === 2 && maxMultiplier < 3) {
            maxMultiplier = 3;
        } else if (mc === 1 && maxMultiplier < 2) {
            maxMultiplier = 2;
        }
    }
    
    // 如果没有下注或没有中奖，倍率为 0
    if (!hasWin) {
        maxMultiplier = 0;
    }
    
    // 添加到历史记录
    gameHistory.push({
        multiplier: maxMultiplier,
        isWin: hasWin
    });
    
    // 只保留最近 5 条
    if (gameHistory.length > 5) {
        gameHistory.shift();
    }
    
    // 更新 UI
    updateHistoryUI();
}

/**
 * 更新历史记录 UI
 */
function updateHistoryUI() {
    const historyBar = document.getElementById('historyBar');
    if (!historyBar) return;
    
    historyBar.innerHTML = '';
    
    gameHistory.forEach(record => {
        const item = document.createElement('div');
        item.className = `history-item ${record.isWin ? 'win' : 'lose'}`;
        
        const multiplierText = document.createElement('span');
        multiplierText.className = 'multiplier';
        multiplierText.textContent = 'x' + record.multiplier;
        
        item.appendChild(multiplierText);
        historyBar.appendChild(item);
    });
}

// -------------- 摇骰子 --------------

/**
 * 处理 Bet 按钮点击
 */
function handleBetClick() {
    console.log('[handleBetClick] currentTab:', currentTab, 'isAutoPlaying:', isAutoPlaying);
    
    if (currentTab === 'auto') {
        console.log('[handleBetClick] Auto tab');
        // 自动页签：开始/停止自动游戏
        if (isAutoPlaying) {
            console.log('[handleBetClick] Stopping auto play');
            stopAutoPlay('User stopped');
        } else {
            // 自动游戏不需要用户先下注，系统会自动选择颜色
            console.log('[handleBetClick] Starting auto play');
            startAutoPlay();
        }
    } else {
        console.log('[handleBetClick] Manual tab, rolling dice');
        // 手动页签：普通摇子
        rollDice();
    }
}

function rollDice() {
    // 如果正在自动游戏，不响应手动点击（但允许 executeAutoBet 内部调用）
    // 这个检查只阻止用户手动点击，不阻止自动游戏内部调用
    if (isRolling) return;
    const total = bets.reduce((a, b) => a + b, 0) * _betAmount;
    if (total === 0) return;

    // 播放点击音效
    playSound(audioQuick);

    isRolling = true;
    document.getElementById('rollBtn').disabled = true;
    const clearBtnEl = document.getElementById('clearBtn');
    if (clearBtnEl) clearBtnEl.disabled = true;
    document.querySelectorAll('.color-btn').forEach(b => b.disabled = true);
    document.querySelectorAll('.payout-check').forEach(c => c.classList.remove('checked'));

    showHint('Rolling...', '');

    // 播放骰子滚动音效
    playSound(audioRoll);

    // 取消上次的延迟清理定时器（防止误清除新骰子）
    if (_cleanupTimer) {
        clearTimeout(_cleanupTimer);
        _cleanupTimer = null;
    }

    // 清除旧骰子
    if (activeDice.length) {
        activeDice.forEach(d => d.destroy());
        activeDice = [];
    }
    document.getElementById('diceContainer').innerHTML = '';

    // ========== 调用 main.jsx 中的 startBet 获取服务器结果 ==========
    // startBet 接收 6 种颜色的下注次数
    if (typeof window.startBet === 'function') {
        window.startBet(bets[0], bets[1], bets[2], bets[3], bets[4], bets[5], function(err, data) {
            if (err) {
                console.error('startBet error:', err);
                // 出错时使用本地随机结果作为备用
                const results = rollDiceRandom();
                console.log('=== 本地随机模式（备用）===');
                console.log('骰子结果:', results, results.map(i => COLORS[i].label));
                startRollAnimation(results);
                return;
            }
            
            // 从服务器返回的数据中提取骰子结果
            // data.diceResult 格式应该是类似 [0, 1, 2] 的数组，代表三个骰子的颜色索引
            let result = data.diceResult || [];
            console.log('=== 服务器返回数据 ===');
            console.log('骰子结果 (diceResult):', result);
            console.log('骰子结果 (颜色名称):', result.map(i => COLORS[i] ? COLORS[i].label : '未知'));
            console.log('下注详情 (details):', data.details);
            
            // 验证：检查 details 数组，打印每个下注颜色的命中情况
            if (data.details && Array.isArray(data.details)) {
                console.log('--- 下注详情分析 ---');
                for (let i = 0; i < data.details.length; i++) {
                    const detail = data.details[i];
                    console.log(`  颜色索引 ${detail.colorIndex} (${COLORS[detail.colorIndex] ? COLORS[detail.colorIndex].label : '未知'}): 下注次数=${detail.count}, 命中数量=${detail.hitCount}`);
                }
            }
            
            startRollAnimation(result);
        });
    } else {
        // 如果 startBet 不可用，使用本地随机结果
        console.log('=== 本地随机模式（无服务器）===');
        const results = rollDiceRandom();
        console.log('骰子结果:', results, results.map(i => COLORS[i].label));
        console.log('下注情况:', betAmounts);
        startRollAnimation(results);
    }
    // ================================================
}

// -------------- 结算 --------------

function finishRoll(results) {
    isRolling = false;
    document.getElementById('rollBtn').disabled = false;
    const clearBtnEl = document.getElementById('clearBtn');
    if (clearBtnEl) clearBtnEl.disabled = false;
    document.querySelectorAll('.color-btn').forEach(b => b.disabled = false);
    
    // 如果在自动游戏中，更新按钮样式为"Stop Auto"
    if (isAutoPlaying) {
        updateAutoPlayUI();
    }
    
    console.log('=== 结算开始 ===');
    console.log('骰子结果:', results, '→', results.map(i => COLORS[i].label));
    console.log('下注金额:', betAmounts);
    console.log('下注次数:', bets);
    
    let totalWin = 0;
    let winMessages = [];
    let maxHitCount = 0;  // 记录最高命中骰子数

    for (let ci = 0; ci < 6; ci++) {
        if (betAmounts[ci] === 0) continue;
        const mc  = results.filter(r => r === ci).length;
        const bet = betAmounts[ci];  // 使用实际下注金额
        console.log(`颜色 ${ci} (${COLORS[ci].label}): 下注=${bet}, 命中数量=${mc}`);
        let win = 0;
        if (mc === 1) {
            win = bet * 2;
            if (mc > maxHitCount) maxHitCount = mc;
        }
        else if (mc === 2) {
            win = bet * 3;
            if (mc > maxHitCount) maxHitCount = mc;
        }
        else if (mc === 3) {
            win = Math.floor(bet * 16);
            if (mc > maxHitCount) maxHitCount = mc;
        }
        if (win > 0) {
            totalWin += win;
            const mult = mc === 1 ? 2 : mc === 2 ? 3 : 16;
            winMessages.push(COLORS[ci].label + ' hit ' + mc + ' x' + mult);
            console.log(`  → 中奖！赢得 ${win}`);
        } else {
            console.log(`  → 未中奖`);
        }
    }
    
    console.log('=== 结算结束 ===');
    console.log('总下注:', betAmounts.reduce((a, b) => a + b, 0));
    console.log('总赢得:', totalWin);

    let maxMatch = 0;
    for (let ci = 0; ci < 6; ci++) {
        if (betAmounts[ci] === 0) continue;
        maxMatch = Math.max(maxMatch, results.filter(r => r === ci).length);
    }
    // 添加空值检查，防止元素不存在时报错
    const check1 = document.getElementById('check1');
    const check2 = document.getElementById('check2');
    const check3 = document.getElementById('check3');
    if (maxMatch >= 1 && check1) check1.classList.add('checked');
    if (maxMatch >= 2 && check2) check2.classList.add('checked');
    if (maxMatch >= 3 && check3) check3.classList.add('checked');

    if (totalWin > 0) {
        balance += totalWin;
        // 已付费玩家需要更新最大下注金额
        if (isRechargeUser) {
            betConfig.maxBetAmount = balance;
        }
        //showHint('Congratulations! Won ' + totalWin + '!', 'win');
        //spawnCoins();
        
        // 播放中奖音效
        playSound(audioWin);
        
        // 收集中奖且有下注的颜色索引，触发格子闪烁效果
        const winningColors = [];
        for (let ci = 0; ci < 6; ci++) {
            if (betAmounts[ci] > 0) {
                const mc = results.filter(r => r === ci).length;
                if (mc > 0) {
                    winningColors.push(ci);
                }
            }
        }
        triggerWinFlash(winningColors);
        
        // 显示胜利结算图层（传入最高命中骰子数）
        showWinOverlay(totalWin, maxHitCount);
    } else {
        showHint('Sorry, try again!', 'lose');
        // 播放失败音效
        playSound(audioLose);
    }

    // 重置下注数据（游戏结束）
    // 注意：必须先添加历史记录，再重置 betAmounts，否则历史记录无法计算倍率
    addHistoryRecord(results, totalWin);
    
    bets = [0, 0, 0, 0, 0, 0];
    betAmounts = [0, 0, 0, 0, 0, 0];
    _lockedBetAmount = null;  // 重置本局锁定的下注金额
    
    updateUI();
    // 结算后用户需要重新下注，updateUI() 会根据 bets 状态正确控制按钮

    // 延迟清理骰子（保存 ID 以便下次 rollDice 时取消，防止误清除新骰子）
    _cleanupTimer = setTimeout(() => {
        activeDice.forEach(d => d.destroy());
        activeDice = [];
        document.getElementById('diceContainer').innerHTML = '';
        _cleanupTimer = null;
    }, 3000);
    
    // 如果是自动游戏，3 秒后执行下一次
    if (isAutoPlaying) {
        console.log('[AutoPlay] Waiting 3s for next game...');
        autoPlayTimer = setTimeout(() => {
            if (isAutoPlaying) {
                executeAutoBet();
            }
        }, 3000);
    }
}

// -------------- 金币雨 --------------

function spawnCoins() {
    for (let i = 0; i < 18; i++) {
        setTimeout(() => {
            const coin = document.createElement('div');
            coin.className = 'coin';
            coin.textContent = ['💰','🪙','💎','✨'][Math.floor(Math.random() * 4)];
            coin.style.left = (Math.random() * window.innerWidth) + 'px';
            coin.style.top  = (Math.random() * 120 + 80) + 'px';
            coin.style.fontSize = (18 + Math.random() * 12) + 'px';
            document.body.appendChild(coin);
            setTimeout(() => coin.remove(), 1400);
        }, i * 70);
    }
}

// -------------- 初始化 --------------
// 初始化玩家数据（实际应由服务器下发，此处暂时使用默认值）
// 测试时可修改 isRecharge 来切换付费/未付费状态
const urlParams = new URLSearchParams(window.location.search);
const accessToken = urlParams.get("token");
console.log('[Game Init] accessToken:', accessToken);

if(accessToken === undefined || accessToken === null){
    console.log('[Game Init] No token, initializing with default data...');
    initPlayerData({
        initialAmount: 1000,
        isRecharge: true // false=未付费，true=已付费
    });
} else {
    // 如果有 token 但未从服务器获取数据，也初始化一个默认余额用于测试
    console.log('[Game Init] Token exists, initializing with default data for testing...');
    initPlayerData({
        initialAmount: 1000,
        isRecharge: true
    });
}
console.log('[Game Init] Initialized - balance:', balance, 'isRechargeUser:', isRechargeUser, 'betConfig:', getBetConfig(), '_betAmount:', _betAmount);

// 初始化音效
initAudio();

// ============================================================
//  页签切换功能
// ============================================================

/**
 * 切换页签（手动/自动）
 * @param {string} tab - 'manual' 或 'auto'
 */
function switchTab(tab) {
    // 未付费玩家不能使用 Auto 功能
    if (tab === 'auto' && !isRechargeUser) {
        showHint('Auto mode is only available for paid users', 'error');
        return;
    }
    
    // 如果从自动页签切换到手动页签，停止自动游戏
    if (currentTab === 'auto' && tab === 'manual' && isAutoPlaying) {
        stopAutoPlay('User switched to manual tab');
    }
    
    // 切换页签时清空已下注的筹码
    clearAllBets();
    
    // 无论是否有下注，都清除选中样式
    document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('selected'));
    
    currentTab = tab;
    
    // 更新按钮状态
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.tab === tab) {
            btn.classList.add('active');
        }
    });
    
    // 更新投注数量区域显示
    const quantityTitle = document.getElementById('betQuantityTitle');
    const quantityRow = document.getElementById('betQuantityRow');
    
    // 更新高级设置区域显示
    const advancedSettings = document.getElementById('advancedSettings');
    
    if (tab === 'auto') {
        // 自动页签：显示投注数量区域和高级设置
        quantityTitle.style.display = 'block';
        quantityRow.style.display = 'flex';
        advancedSettings.style.display = 'block';
        
        // 重置按钮为开始状态
        updateAutoPlayUI();
        
        // 初始化高级设置输入框状态（未选色块时禁用）
        updateAdvancedInputsState();
    } else {
        // 手动页签：隐藏投注数量区域和高级设置
        quantityTitle.style.display = 'none';
        quantityRow.style.display = 'none';
        advancedSettings.style.display = 'none';
        
        // 重置按钮为手动模式
        const rollBtn = document.getElementById('rollBtn');
        if (rollBtn) {
            rollBtn.textContent = 'Bet';
            rollBtn.style.background = '#2a8a2a';
            rollBtn.style.boxShadow = '0 3px 10px rgba(42,138,42,0.3)';
            rollBtn.disabled = false;
        }
    }
    
    console.log('[Tab Switch] Current tab:', tab);
}

/**
 * 切换高级设置展开/收起状态
 */
function toggleAdvancedSettings() {
    const content = document.getElementById('advancedContent');
    const toggleBtn = document.getElementById('advancedToggleBtn');
    
    if (content.classList.contains('expanded')) {
        // 收起
        content.classList.remove('expanded');
        toggleBtn.classList.add('collapsed');
        toggleBtn.textContent = '▼';
    } else {
        // 展开
        content.classList.add('expanded');
        toggleBtn.classList.remove('collapsed');
        toggleBtn.textContent = '▲';
    }
}

/**
 * 验证整数输入（只允许数字）
 * @param {HTMLInputElement} input - 输入框元素
 */
function validateIntegerInput(input) {
    // 移除非数字字符
    input.value = input.value.replace(/[^0-9]/g, '');
}

// ============================================================
//  自动游戏功能
// ============================================================

/**
 * 随机选择一个颜色进行下注
 * @returns {number} 颜色索引 (0-5)
 */
function randomSelectColor() {
    return Math.floor(Math.random() * 6);
}

/**
 * 检查是否应该停止自动游戏
 * @returns {Object} {shouldStop: boolean, reason: string}
 */
function checkAutoPlayStopConditions() {
    // 1. 检查是否达到游玩次数
    if (autoPlayMaxGames > 0 && autoPlayGamesPlayed >= autoPlayMaxGames) {
        console.log('[AutoPlay] Stop condition: Max games reached');
        return {
            shouldStop: true,
            reason: `Reached maximum games (${autoPlayMaxGames})`
        };
    }
    
    // 2. 检查止盈（总余额达到止盈金额）
    console.log('[AutoPlay] Check TakeProfit - Balance:', balance, 'Target:', autoPlayTakeProfit);
    if (autoPlayTakeProfit > 0 && balance >= autoPlayTakeProfit) {
        console.log('[AutoPlay] Stop condition: Take profit reached');
        return {
            shouldStop: true,
            reason: `Take profit reached (Balance: ${balance})`
        };
    }
    
    // 3. 检查止损（总余额低于止损金额）
    console.log('[AutoPlay] Check StopLoss - Balance:', balance, 'Limit:', autoPlayStopLoss);
    if (autoPlayStopLoss > 0 && balance <= autoPlayStopLoss) {
        console.log('[AutoPlay] Stop condition: Stop loss reached');
        return {
            shouldStop: true,
            reason: `Stop loss reached (Balance: ${balance})`
        };
    }
    
    // 4. 检查余额是否足够
    const config = getBetConfig();
    const singleBetAmount = _betQuantity === 'inf' ? 1 : _betQuantity;
    const requiredBalance = singleBetAmount * _betAmount;
    
    if (balance < requiredBalance) {
        return {
            shouldStop: true,
            reason: `Insufficient balance (Need: ${requiredBalance}, Have: ${balance})`
        };
    }
    
    return { shouldStop: false, reason: '' };
}

/**
 * 执行一次自动下注
 */
function executeAutoBet() {
    if (!isAutoPlaying) {
        console.log('[AutoPlay] executeAutoBet: isAutoPlaying is false, returning');
        return;
    }
    
    // 检查是否应该停止
    const stopCheck = checkAutoPlayStopConditions();
    if (stopCheck.shouldStop) {
        console.log('[AutoPlay] Stopping:', stopCheck.reason);
        stopAutoPlay(stopCheck.reason);
        return;
    }
    
    // 使用玩家选择的颜色数组（如果没有选择，默认第一个颜色）
    const colorIndexes = _autoPlayColorIndexes.length > 0 ? _autoPlayColorIndexes : [0];
    console.log('[AutoPlay] Game', autoPlayGamesPlayed + 1, '- Betting on:', 
                colorIndexes.map(i => COLORS[i].label));
    
    // 清除所有下注（自动游戏每局都会清除旧下注）
    clearAllBets();
    
    // 对每个选中的颜色下注
    colorIndexes.forEach(colorIndex => {
        const colorBtn = document.querySelector(`.color-btn[data-index="${colorIndex}"]`);
        if (colorBtn) {
            addBet(colorBtn, 1, true);  // 传入 true 表示是自动游戏，跳过锁定检查
        }
    });
    
    // 开始游戏
    rollDice();
    
    // 增加已游玩次数
    autoPlayGamesPlayed++;
}

/**
 * 开始自动游戏
 */
function startAutoPlay() {
    if (isAutoPlaying) return;
    
    // 保存当前的下注金额（防止 clearAllBets 重置）
    const savedBetAmount = _betAmount;
    
    // 获取止盈止损设置
    const takeProfitInput = document.getElementById('takeProfitInput');
    const stopLossInput = document.getElementById('stopLossInput');
    
    autoPlayTakeProfit = parseInt(takeProfitInput?.value) || 0;
    autoPlayStopLoss = parseInt(stopLossInput?.value) || 0;
    
    // 获取游玩次数
    autoPlayMaxGames = _betQuantity === 'inf' ? 0 : _betQuantity;
    
    // 使用玩家在自动页签选择的颜色数组（如果没有选择，默认第一个颜色）
    console.log('[AutoPlay] Using selected color indexes:', _autoPlayColorIndexes, 
                _autoPlayColorIndexes.map(i => COLORS[i].label));
    
    // 记录初始余额
    autoPlayStartBalance = balance;
    autoPlayGamesPlayed = 0;
    
    // 清除所有手动下注（自动游戏会自己下注）
    clearAllBets();
    
    // 恢复下注金额
    _betAmount = savedBetAmount;
    updateBetAmountDisplay();
    
    // 标记为自动游戏状态
    isAutoPlaying = true;
    
    console.log('[AutoPlay] Started - MaxGames:', autoPlayMaxGames || '∞', 
                'TakeProfit:', autoPlayTakeProfit, 
                'StopLoss:', autoPlayStopLoss,
                'StartBalance:', autoPlayStartBalance,
                'BetAmount:', _betAmount);
    
    // 更新 UI
    updateAutoPlayUI();
    
    // 立即执行第一次
    executeAutoBet();
}

/**
 * 停止自动游戏
 * @param {string} reason - 停止原因
 */
function stopAutoPlay(reason) {
    if (!isAutoPlaying) return;
    
    isAutoPlaying = false;
    
    if (autoPlayTimer) {
        clearTimeout(autoPlayTimer);
        autoPlayTimer = null;
    }
    
    console.log('[AutoPlay] Stopped:', reason || 'User stopped');
    
    // 更新 UI
    updateAutoPlayUI();
    
    // 显示提示
    if (reason) {
        showToast(reason);
    }
}

/**
 * 更新自动游戏 UI 状态
 */
function updateAutoPlayUI() {
    const rollBtn = document.getElementById('rollBtn');
    if (!rollBtn) return;
    
    if (isAutoPlaying) {
        rollBtn.textContent = 'Stop Auto';
        rollBtn.style.background = '#a54444';
        rollBtn.style.boxShadow = '0 3px 10px rgba(165,68,68,0.3)';
        rollBtn.disabled = false;  // 确保按钮可以点击
        console.log('[updateAutoPlayUI] Auto playing, button set to "Stop Auto"');
    } else {
        // 根据当前页签设置按钮文本
        if (currentTab === 'auto') {
            rollBtn.textContent = 'Start Auto Bet';
        } else {
            rollBtn.textContent = 'Bet';
        }
        rollBtn.style.background = '#2a8a2a';
        rollBtn.style.boxShadow = '0 3px 10px rgba(42,138,42,0.3)';
        rollBtn.disabled = false;  // 确保按钮可以点击
        console.log('[updateAutoPlayUI] Auto stopped, button set to "' + rollBtn.textContent + '"');
    }
}

// 初始化页签状态（默认为手动页签）
switchTab('manual');

// 测试用：可通过控制台调用 setRechargeStatus(true/false) 切换状态
// 例如：setRechargeStatus(false) 切换为未付费玩家
