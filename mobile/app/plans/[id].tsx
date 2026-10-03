import { View } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import type { PlanDetail, PlansList } from '../../src/api/types'
import { PlanApprove } from '../../src/components/Decision'
import { PlanRevision } from '../../src/components/PlanRevision'
import { PlanBody, periodNumber } from '../../src/components/PlanBody'
import { Screen } from '../../src/components/Screen'
import { useHub } from '../../src/use-hub'
import { useViewTracking } from '../../src/usage'
import { t } from '../../src/i18n'
export { PageError as ErrorBoundary } from '../../src/components/PageError'

export default function PlanDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const view = useHub<PlanDetail>(`/plans/${encodeURIComponent(id)}`)
  const plans = useHub<PlansList>('/plans')
  useViewTracking('plan_detail')
  return (
    <Screen view={view} head={{ kind: 'back', label: t('计划') }}>
      {(detail) => (
        <>
          <PlanRevision plan={detail.plan} />
          {detail.plan.status === 'draft' ? (
            <View style={{ flexDirection: 'row' }}>
              <PlanApprove plan={detail.plan} />
            </View>
          ) : null}
          <PlanBody detail={detail} number={plans.data === null ? null : periodNumber(plans.data.plans, detail.plan.id)} />
        </>
      )}
    </Screen>
  )
}
