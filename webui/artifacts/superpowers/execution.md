# 执行记录：优化轻点配额卡片2-3秒自动淡出消失与防误触

## 变更文件与实现
1. `src/modules/pet/engine/hagemiEngine.js`：
   - **独立 `autoHideTimer` 定时器**：将自动消失定时器与悬停 `hoverTimer` 解耦，杜绝被触屏合成的 `pointerenter` 意外清空；
   - **黄金停留时间 2.6 秒**：轻点猫娘弹出小鱼干配额卡片后，精确常驻 2.6 秒，随后自动丝滑淡出隐藏；
   - **触屏事件保护**：在 `pointerenter` 中加入 `if (event.pointerType === 'touch') return;`，防止手机端手指抬起时误打断自动隐藏倒计时；
   - **点击外部即关**：当用户点击屏幕空白处或主聊天窗口时，立即调用 `hideHud(true)` 关闭卡片。
