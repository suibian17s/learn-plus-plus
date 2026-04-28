import type { ThemeConfig } from 'antd'

export const tsinghuaTheme: ThemeConfig = {
  token: {
    colorPrimary: '#5B57D9',
    colorPrimaryHover: '#6F67F2',
    colorPrimaryActive: '#4743BD',
    colorInfo: '#5B57D9',
    colorLink: '#5B57D9',
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
      itemSelectedBg: '#F0EEFF',
      itemSelectedColor: '#5B57D9',
      itemHoverBg: '#F6F5FF',
    },
    Tabs: {
      inkBarColor: '#5B57D9',
      itemSelectedColor: '#5B57D9',
    },
    Button: {
      primaryShadow: 'none',
    },
  },
}
