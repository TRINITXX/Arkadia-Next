import type { ColorValue } from "react-native";
import Svg, { G, Path } from "react-native-svg";

/** Arkadia's monochrome mark used in native navigation and headers. */
export function ArkadiaMark(props: { readonly height: number; readonly color: ColorValue }) {
  return (
    <Svg
      accessibilityLabel="Arkadia"
      height={props.height}
      width={props.height}
      viewBox="0 0 144 144"
    >
      <G transform="translate(0 6) scale(-1 1) translate(-144 0)">
        <Path
          d="m112.5 128.5h-109.3l53.8-99.3 11.7 21.8-31.7 57.9h64.5l10.6 19.5 0.4 0.1zm-105.1-2.6h100.1l-7.7-13.9-67.4-0.4 33.3-60.6-8.7-16.5-49.6 91.4z"
          fill={props.color}
          fillRule="evenodd"
        />
        <Path d="m117.8 128.5-57.7-103.9 11.7-22.2 70.2 126.1h-24.2z" fill={props.color} />
      </G>
    </Svg>
  );
}
