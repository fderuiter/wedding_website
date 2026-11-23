const NEUTRAL_FAMILIES = '(?:gray|stone|slate|zinc|neutral)';

const UNCALIBRATED_LIGHT_400_RE = new RegExp(
  `^!?text-${NEUTRAL_FAMILIES}-400(?:\\/\\d+)?$`
);
const UNCALIBRATED_DARK_500_RE = new RegExp(
  `^!?dark:text-${NEUTRAL_FAMILIES}-(?:500|600)(?:\\/\\d+)?$`
);
const LIGHT_500_RE = new RegExp(
  `^!?text-${NEUTRAL_FAMILIES}-500(?:\\/\\d+)?$`
);
const CALIBRATED_DARK_TEXT_COMPANION_RE = new RegExp(
  `^!?dark:text-(?:white|${NEUTRAL_FAMILIES}-(?:50|100|200|300|400)|primary(?:-text|-light)?|secondary(?:-text|-light)?|muted-text|\\[var\\(--)`
);
const ELEVATED_DARK_BG_RE = new RegExp(
  `^!?(?:dark:)?bg-${NEUTRAL_FAMILIES}-(?:600|700)(?:\\/\\d+)?$`
);
const TRANSLUCENT_WHITE_BG_RE = /^!?bg-white\/(?:[5-9]\d|100)$/;
const DARK_BG_COMPANION_RE = /^!?dark:bg-/;
const EXPLICIT_DARK_FG_TEXT_RE = new RegExp(
  `^!?text-(?:black|${NEUTRAL_FAMILIES}-(?:700|800|900|950)|primary(?:-text)?|secondary(?:-text)?|muted-text|\\[var\\(--(?:toast-action-text|color-primary-text|color-foreground|form-label-text))`
);

const CLASS_HELPER_CALLEES = new Set(['cn', 'clsx', 'twMerge', 'twJoin', 'cva']);
const MAX_COMBINATIONS = 16;

function splitClassTokens(rawValue, node) {
  if (!rawValue || typeof rawValue !== 'string') {
    return [];
  }
  return rawValue
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => ({ token, node }));
}

function combineTokenSets(leftSets, rightSets) {
  if (leftSets.length === 0) return rightSets;
  if (rightSets.length === 0) return leftSets;

  if (leftSets.length * rightSets.length > MAX_COMBINATIONS) {
    const merged = [
      ...leftSets.flat(),
      ...rightSets.flat(),
    ];
    return [merged];
  }

  const combined = [];
  for (const left of leftSets) {
    for (const right of rightSets) {
      combined.push([...left, ...right]);
    }
  }
  return combined;
}

const noUncalibratedContrastUtilitiesRule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'disallow uncalibrated 400/500 neutral text utilities and unpaired translucent bg-white/* light surfaces',
      category: 'Accessibility',
      recommended: true,
    },
    schema: [],
    messages: {
      uncalibratedNeutralText:
        'Uncalibrated neutral text utility "{{ utility }}" violates WCAG 1.4.3 contrast minimums. Use semantic "text-muted-text" (or pair with a calibrated dark/surface token) instead.',
      unpairedTranslucentLightBg:
        'Translucent light background "{{ utility }}" is missing a "dark:bg-*" override or explicit dark foreground text utility (WCAG F24). Use shared Button/surface primitives or pair an explicit foreground color.',
    },
  },
  create(context) {
    const visitedNodes = new WeakSet();
    const reportedKeys = new Set();

    function markSubtreeVisited(node) {
      if (!node || typeof node !== 'object' || visitedNodes.has(node)) {
        return;
      }
      visitedNodes.add(node);
      for (const [key, val] of Object.entries(node)) {
        if (key === 'parent' || key === 'loc' || key === 'range') continue;
        if (Array.isArray(val)) {
          for (const item of val) {
            if (item && typeof item.type === 'string') {
              markSubtreeVisited(item);
            }
          }
        } else if (val && typeof val === 'object' && typeof val.type === 'string') {
          markSubtreeVisited(val);
        }
      }
    }

    function expandExpressionTokenSets(expr) {
      if (!expr) return [[]];

      switch (expr.type) {
        case 'Literal': {
          if (typeof expr.value === 'string') {
            return [splitClassTokens(expr.value, expr)];
          }
          return [[]];
        }
        case 'TemplateLiteral': {
          let sets = [[]];
          for (let i = 0; i < expr.quasis.length; i += 1) {
            const quasi = expr.quasis[i];
            const cooked = quasi.value.cooked ?? quasi.value.raw;
            sets = combineTokenSets(sets, [splitClassTokens(cooked, quasi)]);
            if (i < expr.expressions.length) {
              sets = combineTokenSets(sets, expandExpressionTokenSets(expr.expressions[i]));
            }
          }
          return sets;
        }
        case 'JSXExpressionContainer':
          return expandExpressionTokenSets(expr.expression);
        case 'ConditionalExpression': {
          const consequentSets = expandExpressionTokenSets(expr.consequent);
          const alternateSets = expandExpressionTokenSets(expr.alternate);
          const merged = [...consequentSets, ...alternateSets];
          return merged.length > MAX_COMBINATIONS
            ? [[...consequentSets.flat(), ...alternateSets.flat()]]
            : merged;
        }
        case 'LogicalExpression': {
          if (expr.operator === '&&') {
            const rightSets = expandExpressionTokenSets(expr.right);
            return [[], ...rightSets].slice(0, MAX_COMBINATIONS);
          }
          const leftSets = expandExpressionTokenSets(expr.left);
          const rightSets = expandExpressionTokenSets(expr.right);
          return [...leftSets, ...rightSets].slice(0, MAX_COMBINATIONS);
        }
        case 'CallExpression': {
          const calleeName =
            expr.callee.type === 'Identifier'
              ? expr.callee.name
              : expr.callee.type === 'MemberExpression' && expr.callee.property.type === 'Identifier'
                ? expr.callee.property.name
                : null;
          if (calleeName && CLASS_HELPER_CALLEES.has(calleeName)) {
            let sets = [[]];
            for (const arg of expr.arguments) {
              if (arg.type === 'SpreadElement') continue;
              sets = combineTokenSets(sets, expandExpressionTokenSets(arg));
            }
            return sets;
          }
          return [[]];
        }
        case 'ArrayExpression': {
          let sets = [[]];
          for (const elem of expr.elements) {
            if (!elem || elem.type === 'SpreadElement') continue;
            sets = combineTokenSets(sets, expandExpressionTokenSets(elem));
          }
          return sets;
        }
        case 'ObjectExpression': {
          let sets = [[]];
          for (const prop of expr.properties) {
            if (prop.type !== 'Property') continue;
            let keyText = null;
            if (prop.key.type === 'Literal' && typeof prop.key.value === 'string') {
              keyText = prop.key.value;
            } else if (!prop.computed && prop.key.type === 'Identifier') {
              keyText = prop.key.name;
            }
            if (keyText) {
              sets = combineTokenSets(sets, [[], splitClassTokens(keyText, prop.key)]);
            }
          }
          return sets;
        }
        default:
          return [[]];
      }
    }

    function reportOnce(node, messageId, utility) {
      const locKey = node.range
        ? `${node.range[0]}:${node.range[1]}:${messageId}:${utility}`
        : `${messageId}:${utility}`;
      if (reportedKeys.has(locKey)) return;
      reportedKeys.add(locKey);
      context.report({
        node,
        messageId,
        data: { utility },
      });
    }

    function validateTokenSet(entries) {
      if (!entries || entries.length === 0) return;

      const tokens = entries.map((entry) => entry.token);
      const hasDarkTextCompanion = tokens.some((t) => CALIBRATED_DARK_TEXT_COMPANION_RE.test(t));
      const hasElevatedDarkBg = tokens.some((t) => ELEVATED_DARK_BG_RE.test(t));
      const hasDarkBgCompanion = tokens.some((t) => DARK_BG_COMPANION_RE.test(t));
      const hasExplicitDarkFg = tokens.some((t) => EXPLICIT_DARK_FG_TEXT_RE.test(t));

      for (const { token, node } of entries) {
        if (UNCALIBRATED_LIGHT_400_RE.test(token) || UNCALIBRATED_DARK_500_RE.test(token)) {
          reportOnce(node, 'uncalibratedNeutralText', token);
          continue;
        }

        if (LIGHT_500_RE.test(token) && (!hasDarkTextCompanion || hasElevatedDarkBg)) {
          reportOnce(node, 'uncalibratedNeutralText', token);
          continue;
        }

        if (TRANSLUCENT_WHITE_BG_RE.test(token) && !hasDarkBgCompanion && !hasExplicitDarkFg) {
          reportOnce(node, 'unpairedTranslucentLightBg', token);
        }
      }
    }

    return {
      JSXAttribute(node) {
        if (node.name.type !== 'JSXIdentifier') return;
        const attrName = node.name.name;
        if (attrName !== 'className' && !attrName.endsWith('ClassName')) return;
        if (!node.value) return;

        markSubtreeVisited(node.value);
        const tokenSets = expandExpressionTokenSets(node.value);
        for (const set of tokenSets) {
          validateTokenSet(set);
        }
      },
      Literal(node) {
        if (visitedNodes.has(node) || typeof node.value !== 'string') return;
        const parent = node.parent;
        if (
          parent &&
          (parent.type === 'ImportDeclaration' ||
            parent.type === 'ExportNamedDeclaration' ||
            parent.type === 'ExportAllDeclaration')
        ) {
          return;
        }
        validateTokenSet(splitClassTokens(node.value, node));
      },
      TemplateLiteral(node) {
        if (visitedNodes.has(node)) return;
        markSubtreeVisited(node);
        const tokenSets = expandExpressionTokenSets(node);
        for (const set of tokenSets) {
          validateTokenSet(set);
        }
      },
    };
  },
};

export default noUncalibratedContrastUtilitiesRule;
