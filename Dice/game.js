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
const UNRECHARGED_CONFIG = {
    minBetAmount: 10,    // 最小下注金额
    maxBetAmount: 1000,  // 最大下注金额
    maxBetTimes: 3       // 最大下注次数（颜色数量）
};

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
    { rx:   0, ry:  90 }, // 2=right  → Y 轴旋转 90°，让右面朝摄像机（CSS 初始是 +90°朝右，需要 -90°才能朝前，但旋转方向相反所以是 +90°）
    { rx:   0, ry: -90 }, // 3=left   → Y 轴旋转 -90°，让左面朝摄像机
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
        { x: 58,  y: 175 },
        { x: 136, y: 175 },
        { x: 214, y: 175 },
    ];
    const endY = 370; // 停止时的 Y 位置

    const t0 = performance.now();

    // 创建骰子实例
    activeDice = results.map((colorIdx, i) => {
        const d = new Dice3D(container, dicePositions[i], i);
        d.setTarget(colorIdx);
        d._endY   = endY;
        d._startY = dicePositions[i].y;
        d._phase  = 'waiting';
        d._delay  = i * 250;       // 错开启动
        d._duration = 2200 + i * 300; // 总时长 ms
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
                // 阶段1：快速旋转 + 下落
                const p = progress / 0.75;
                const spinFactor = 1 - p * 0.65;

                d.rx += (0.2 + Math.sin(p * 10) * 0.05) * spinFactor * 360 / 60;
                d.ry += (0.16 + Math.cos(p * 8) * 0.04) * spinFactor * 360 / 60;

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
            showToast(`Min bet: ${config.minBetAmount}`);
        }
    }
    
    // 检查最大金额限制
    if (val > config.maxBetAmount) {
        val = config.maxBetAmount;
        if (!isRechargeUser) {
            showToast(`Max bet: ${config.maxBetAmount}`);
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
        toast.style.fontSize = '14px';
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
        showToast(`Min bet: ${config.minBetAmount}`);
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
    });
}

// 初始化时设置关闭处理器
setupSliderCloseHandler();

/** 调整投注金额（1/2、2×、+1、-1） */
function adjustBetAmount(factor) {
    const config = getBetConfig();
    
    // 未付费玩家禁用所有调整按钮
    if (!isRechargeUser) {
        showToast(`Min: ${config.minBetAmount}, Max: ${config.maxBetAmount}`);
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
        // 上下箭头：+1 或 -1（这个逻辑不会被用到，因为箭头现在是 toggleSlider）
        newVal = Math.max(config.minBetAmount, _betAmount + factor);
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

function addBet(btn) {
    if (isRolling) return;
    
    const config = getBetConfig();
    const idx = parseInt(btn.dataset.index);
    const qty = _betQuantity === 'inf' ? 1 : _betQuantity;
    const cost = qty * _betAmount;
    
    // 检查本局下注金额是否已锁定
    if (_lockedBetAmount !== null) {
        // 已锁定，必须使用相同的下注金额
        const singleBetAmount = _betQuantity === 'inf' ? 1 : _betQuantity;
        const expectedCost = singleBetAmount * _lockedBetAmount;
        
        if (cost !== expectedCost) {
            showToast(`Bet amount locked at ${_lockedBetAmount}.00. Use same amount for all bets.`);
            return;
        }
    }
    
    // 1.3 下注次数限制检查
    if (!isRechargeUser) {
        // 统计当前已下注的颜色数量
        const betColorsCount = bets.filter(b => b > 0).length;
        // 如果这个颜色还没下注，且已达到最大次数限制
        if (bets[idx] === 0 && betColorsCount >= config.maxBetTimes) {
            showToast(`Max ${config.maxBetTimes} colors per round.`);
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
    document.getElementById('rollBtn').disabled = !hasBet || isRolling;
    
    // 1.2 下注金额限制：未付费玩家禁用快捷按钮
    if (!isRechargeUser) {
        // 禁用 1/2、2x、Min、Max 按钮
        document.querySelectorAll('.op-btn').forEach(btn => {
            btn.disabled = true;
        });
        // 禁用上下箭头按钮
        document.querySelectorAll('.arrow-btn').forEach(btn => {
            btn.disabled = true;
        });
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
        // 更新拖动条范围
        updateSliderRange();
    }
}

function showHint(text, type) {
    const hint = document.getElementById('hintText');
    hint.textContent = text;
    hint.className = 'hint-text' + (type ? ' ' + type : '');
}

// -------------- 摇骰子 --------------

function rollDice() {
    if (isRolling) return;
    const total = bets.reduce((a, b) => a + b, 0) * _betAmount;
    if (total === 0) return;

    isRolling = true;
    document.getElementById('rollBtn').disabled = true;
    document.getElementById('clearBtn').disabled = true;
    document.querySelectorAll('.color-btn').forEach(b => b.disabled = true);
    document.querySelectorAll('.payout-check').forEach(c => c.classList.remove('checked'));

    // ========== 随机概率调用位置 ==========
    // 这里调用 rollDiceRandom()，行为由 setDiceProbability() 控制
    // 详见上方【随机概率控制】代码区域
    const results = rollDiceRandom();
    // ================================================

    showHint('Rolling...', '');
    document.getElementById('resultBar').textContent = '...';
    document.getElementById('resultBar').className = 'result-bar';

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

    startRollAnimation(results);
}

// -------------- 结算 --------------

function finishRoll(results) {
    isRolling = false;
    document.getElementById('rollBtn').disabled = false;
    document.getElementById('clearBtn').disabled = false;
    document.querySelectorAll('.color-btn').forEach(b => b.disabled = false);
    
    const resultBar = document.getElementById('resultBar');
    let totalWin = 0;
    let winMessages = [];

    for (let ci = 0; ci < 6; ci++) {
        if (betAmounts[ci] === 0) continue;
        const mc  = results.filter(r => r === ci).length;
        const bet = betAmounts[ci];  // 使用实际下注金额
        let win = 0;
        if (mc === 1)      win = bet * 2;
        else if (mc === 2) win = bet * 3;
        else if (mc === 3) win = Math.floor(bet * 16);
        if (win > 0) {
            totalWin += win;
            const mult = mc === 1 ? 2 : mc === 2 ? 3 : 16;
            winMessages.push(COLORS[ci].label + ' hit ' + mc + ' x' + mult);
        }
    }

    let maxMatch = 0;
    for (let ci = 0; ci < 6; ci++) {
        if (betAmounts[ci] === 0) continue;
        maxMatch = Math.max(maxMatch, results.filter(r => r === ci).length);
    }
    if (maxMatch >= 1) document.getElementById('check1').classList.add('checked');
    if (maxMatch >= 2) document.getElementById('check2').classList.add('checked');
    if (maxMatch >= 3) document.getElementById('check3').classList.add('checked');

    const resultColors = results.map(r => COLORS[r].label).join(', ');

    if (totalWin > 0) {
        balance += totalWin;
        // 已付费玩家需要更新最大下注金额
        if (isRechargeUser) {
            betConfig.maxBetAmount = balance;
        }
        resultBar.textContent = '🎉 ' + winMessages.join(', ') + ' Won ' + totalWin;
        resultBar.className = 'result-bar win';
        showHint('Congratulations! Won ' + totalWin + '!', 'win');
        spawnCoins();
        
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
    } else {
        resultBar.textContent = 'Result: ' + resultColors + ', No match';
        resultBar.className = 'result-bar lose';
        showHint('Sorry, try again!', 'lose');
    }

    // 重置下注数据（游戏结束）
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
initPlayerData({
    initialAmount: 1000,
    isRecharge: true  // false=未付费，true=已付费
});

// 测试用：可通过控制台调用 setRechargeStatus(true/false) 切换状态
// 例如：setRechargeStatus(false) 切换为未付费玩家
