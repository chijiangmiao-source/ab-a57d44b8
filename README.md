# 星间链路校验矩阵最小误码复核系统

在 GF(2) 上对 0/1 校验矩阵 `H`（至多 32 行 × 40 列）与等长综合症 `s`，
**精确**求解 `Hx = s` 的最小汉明重量二进制向量：

- 重量相同的多个解，按列号顺序（第 1 列在最前）逐位比较位串，`0 < 1`，取规范解；
- 不限制误码数、不随机尝试、**不枚举全部 2^40 组合**；
- `s` 不在 `H` 的列空间时只报告“不可综合”，不产出任何证据。

## 算法

Meet-in-the-Middle（中途相遇）：将 40 列切成各至多 20 列的左右两半，
分别枚举每半子集的 XOR（每半至多 2²⁰ 个状态，而非 2⁴⁰），
在两半交界处匹配 `xorL ⊕ xorR = s`，先确定全局最小重量，
再在等重量配对中按全列号位串取规范解。复杂度 O(2^(n/2))，32×40 约 0.2s。

综合症/证据“位串”的第 k 位（1 基位置）对齐标号为 k 的行，
位置 m 回绕到首行（由验收锚点 `I₄ + 0010 → 第4列、证据 0010` 确定）；
这只是固定行置换，不改变最小重量与列侧规范解。见 `lib/syndrome-codec.js`。

## 本地运行（无需安装依赖）

```bash
node server.js                 # 默认 0.0.0.0:8080
PORT=9090 node server.js       # 自定义端口
# 健康路径： GET http://localhost:8080/healthz
# 复核页面： GET http://localhost:8080/
# 复核 API： POST http://localhost:8080/api/verify  {"matrix":"1000\n0100\n0010\n0001","syndrome":"0010"}
```

录入支持空格/逗号分隔的 `0 1`，也支持紧凑串 `0010`（逐字符拆位）。

## Docker Compose

```bash
docker compose up web                       # 宿主机端口默认 8080
HOST_PORT=9090 docker compose up -d web     # 可配置宿主机端口

# 一次性验收服务：运行后退出，退出码 0=通过 / 非0=失败
docker compose run --rm verify
# 或构建并运行（verify 依赖 web 健康检查通过后启动）：
docker compose up --build --abort-on-container-exit verify
```

- `web`：静态服务 + JSON API，带 `/healthz` 健康检查，宿主机端口由 `HOST_PORT` 配置；
- `verify`：一次性服务，对 `http://web:8080` 冒烟，执行单元测试、
  页面构建检查、健康路径与复核页面 API/HTTP 冒烟，以退出码报告。

## 测试

```bash
npm test                 # 求解器/解析器/对齐 单元测试（含与 2^n 暴力枚举对拍）
npm run verify           # 本地拉起服务并执行完整一次性验收
```

## 前端并发语义

每次“发起复核”带递增令牌；草稿任一位被修改（或点击清空）都会使在途结果失效，
旧计算结果返回后直接丢弃，不会覆盖新草稿或当前结论。错误输入时原文保留可编辑，
错误精确定位到行/列/字符位，且旧结论立即消失。

## 目录

```
server.js               静态服务 + /healthz + POST /api/verify
lib/solver.js           MITM 精确最小重量求解
lib/parser.js           草稿解析与错误定位
lib/syndrome-codec.js   综合症位串对齐约定
public/                 复核页面（原生 HTML/JS，无构建步骤）
test/                   单元测试 + 一次性验收运行器 run-all.js
```
