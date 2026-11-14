import type { FocusTarget, SpineNode } from '../types/tree';

interface SpineNavProps {
  spine: SpineNode[];
  selectedIndex: number;
  onHoverNode: (target: FocusTarget | null) => void;
  onSelectNode: (index: number) => void;
}

export function SpineNav({
  spine,
  selectedIndex,
  onHoverNode,
  onSelectNode,
}: SpineNavProps) {
  return (
    <nav
      aria-label="Main nodes along spine"
      className="pointer-events-auto absolute bottom-[112px] left-5 z-10 sm:bottom-[11vh] sm:left-8"
    >
      <ul className="m-0 list-none p-0">
        {spine.map((node, index) => {
          const isSelected = index === selectedIndex;
          return (
            <li
              key={node.id}
              className={`spine-nav-item py-0.5 ${isSelected ? 'is-selected' : ''}`}
            >
              <button
                type="button"
                onMouseEnter={() => onHoverNode({ i: index })}
                onMouseLeave={() => onHoverNode(null)}
                onFocus={() => onHoverNode({ i: index })}
                onBlur={() => onHoverNode(null)}
                onClick={() => onSelectNode(index)}
                className={`block max-w-[210px] cursor-pointer truncate border-0 bg-transparent px-0 py-0.5 text-left text-[14px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#ff9a4d] ${
                  isSelected
                    ? 'font-normal text-white'
                    : 'font-light text-[#8e9bb8] hover:text-white'
                }`}
              >
                {node.name}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
