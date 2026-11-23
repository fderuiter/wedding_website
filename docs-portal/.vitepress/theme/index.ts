import type { Theme } from 'vitepress';
import DefaultTheme from 'vitepress/theme';
import ApiExplorer from './components/ApiExplorer.vue';
import './custom.css';

const theme: Theme = {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('ApiExplorer', ApiExplorer);
  },
};

export default theme;
