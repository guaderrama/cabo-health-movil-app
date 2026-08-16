import type { AnimatedMoleculesProps } from '../../components/AnimatedMolecules';

type IsOptional<T, Key extends keyof T> = {} extends Pick<T, Key> ? true : false;

const activeIsOptional: IsOptional<AnimatedMoleculesProps, 'active'> = false;
const reduceMotionIsOptional: IsOptional<AnimatedMoleculesProps, 'reduceMotion'> = false;

void activeIsOptional;
void reduceMotionIsOptional;
