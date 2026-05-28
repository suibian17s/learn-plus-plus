import type { ComponentType } from 'react'
import {
  AuditOutlined,
  BankOutlined,
  BgColorsOutlined,
  BookOutlined,
  BulbOutlined,
  CalculatorOutlined,
  CodeOutlined,
  CompassOutlined,
  CustomerServiceOutlined,
  ExperimentOutlined,
  FundOutlined,
  GlobalOutlined,
  MedicineBoxOutlined,
  ReadOutlined,
  RocketOutlined,
  SafetyCertificateOutlined,
  ThunderboltOutlined,
  ToolOutlined,
  TrophyOutlined,
} from '@ant-design/icons'

interface CourseIconRule {
  pattern: RegExp
  Icon: ComponentType
  tone: string
}

const COURSE_ICON_RULES: CourseIconRule[] = [
  { pattern: /数学|高数|线代|代数|微积分|概率|统计|数理/, Icon: CalculatorOutlined, tone: 'violet' },
  { pattern: /英语|外语|英文|日语|法语|德语|语言/, Icon: GlobalOutlined, tone: 'sky' },
  { pattern: /物理|力学|电磁|光学|量子/, Icon: ThunderboltOutlined, tone: 'indigo' },
  { pattern: /化学|实验|材料|药物|分子/, Icon: ExperimentOutlined, tone: 'emerald' },
  { pattern: /计算机|编程|程序|代码|Python|Java|C\+\+|算法|数据|软件|网络|机器学习|人工智能|AI/i, Icon: CodeOutlined, tone: 'blue' },
  { pattern: /政治|思修|马原|毛概|近代史|党|哲学|伦理/, Icon: BankOutlined, tone: 'red' },
  { pattern: /体育|运动|健身|体能/, Icon: TrophyOutlined, tone: 'lime' },
  { pattern: /心理|认知|情绪|潜能/, Icon: BulbOutlined, tone: 'amber' },
  { pattern: /经济|金融|管理|会计|营销|创业|商业/, Icon: FundOutlined, tone: 'gold' },
  { pattern: /美术|绘画|设计|艺术|建筑设计|视觉/, Icon: BgColorsOutlined, tone: 'rose' },
  { pattern: /音乐|乐理|声乐|钢琴|合唱/, Icon: CustomerServiceOutlined, tone: 'pink' },
  { pattern: /文学|语文|写作|阅读|新闻|传播/, Icon: ReadOutlined, tone: 'purple' },
  { pattern: /生物|生命|基因|生态/, Icon: MedicineBoxOutlined, tone: 'green' },
  { pattern: /地理|地质|环境|空间|城市/, Icon: CompassOutlined, tone: 'teal' },
  { pattern: /历史|考古|文明|文化/, Icon: BookOutlined, tone: 'brown' },
  { pattern: /工程|电子|电路|信号|机械|制造|自动化|控制|能源/, Icon: ToolOutlined, tone: 'slate' },
  { pattern: /法律|法学|法治|知识产权/, Icon: AuditOutlined, tone: 'navy' },
]

const FALLBACKS: Pick<CourseIconRule, 'Icon' | 'tone'>[] = [
  { Icon: BookOutlined, tone: 'violet' },
  { Icon: RocketOutlined, tone: 'blue' },
  { Icon: SafetyCertificateOutlined, tone: 'emerald' },
  { Icon: BulbOutlined, tone: 'amber' },
  { Icon: CompassOutlined, tone: 'teal' },
]

function fallbackIndex(courseName: string): number {
  let hash = 0
  for (let i = 0; i < courseName.length; i++) {
    hash = ((hash << 5) - hash) + courseName.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash) % FALLBACKS.length
}

export function getCourseIconSpec(courseName: string): Pick<CourseIconRule, 'Icon' | 'tone'> {
  const name = courseName || ''
  const matched = COURSE_ICON_RULES.find((rule) => rule.pattern.test(name))
  if (matched) return matched
  return FALLBACKS[fallbackIndex(name)]
}

export default function CourseIcon({ courseName, size = 'md' }: { courseName: string; size?: 'sm' | 'md' | 'lg' }) {
  const { Icon, tone } = getCourseIconSpec(courseName)
  return (
    <span className={`lp2-course-icon ${tone} ${size}`} aria-hidden="true">
      <Icon />
    </span>
  )
}
