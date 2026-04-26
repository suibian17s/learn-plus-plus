import type { ThemeConfig } from 'antd'

export const tsinghuaTheme: ThemeConfig = {
  token: {
    colorPrimary: '#660874',
    colorPrimaryHover: '#7B2D8E',
    colorPrimaryActive: '#5C246E',
    colorInfo: '#660874',
    colorLink: '#660874',
    borderRadius: 8,
    fontFamily: '"PingFang SC","Microsoft YaHei",-apple-system,system-ui,sans-serif',
    colorBgLayout: '#FAFAFB',
  },
  components: {
    Layout: {
      siderBg: '#FAFAFB',
      headerBg: '#FFFFFF',
    },
    Menu: {
      itemSelectedBg: '#F3E8F7',
      itemSelectedColor: '#660874',
      itemHoverBg: '#F7EFFA',
    },
    Tabs: {
      inkBarColor: '#660874',
      itemSelectedColor: '#660874',
    },
    Button: {
      primaryShadow: 'none',
    },
  },
}
