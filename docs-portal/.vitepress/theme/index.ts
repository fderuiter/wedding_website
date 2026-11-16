import DefaultTheme from 'vitepress/theme';
import ApiExplorer from './components/ApiExplorer.vue';
import './custom.css';

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('ApiExplorer', ApiExplorer);
  }
};
