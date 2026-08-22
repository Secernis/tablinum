import { ArrowAngularTopRight } from '@tailgrids/icons';

export default function DataStats3() {
  return (
    <div className="bg-background-soft-50 flex h-screen items-center justify-center px-4 py-10">
      <div className="bg-background-50 w-full max-w-[345px] rounded-2xl p-5">
        <div className="flex items-end justify-between">
          <div>
            <span className="text-title-50 text-2xl font-semibold">$25.5M</span>
            <span className="text-text-100 ml-1 inline-block text-xs font-normal">
              Fund rised
            </span>
          </div>
          <div className="flex items-center">
            <span className="text-success-500 flex items-center text-xs font-medium">
              +20%
              <ArrowAngularTopRight className="size-3" />
            </span>
          </div>
        </div>
        <div className="mt-6 mb-3 flex w-full items-stretch justify-between">
          {/* <!-- 6 blue bars --> */}
          <div className="bg-primary-500 h-7 w-1.5 rounded-full"></div>
          <div className="bg-primary-500 h-7 w-1.5 rounded-full"></div>
          <div className="bg-primary-500 h-7 w-1.5 rounded-full"></div>
          <div className="bg-primary-500 h-7 w-1.5 rounded-full"></div>
          <div className="bg-primary-500 h-7 w-1.5 rounded-full"></div>
          <div className="bg-primary-500 h-7 w-1.5 rounded-full"></div>

          {/* <!-- 18 gray bars --> */}
          <div className="bg-background-soft-200 h-7 w-1.5 rounded-full"></div>
          <div className="bg-background-soft-200 h-7 w-1.5 rounded-full"></div>
          <div className="bg-background-soft-200 h-7 w-1.5 rounded-full"></div>
          <div className="bg-background-soft-200 h-7 w-1.5 rounded-full"></div>
          <div className="bg-background-soft-200 h-7 w-1.5 rounded-full"></div>
          <div className="bg-background-soft-200 h-7 w-1.5 rounded-full"></div>
          <div className="bg-background-soft-200 h-7 w-1.5 rounded-full"></div>
          <div className="bg-background-soft-200 h-7 w-1.5 rounded-full"></div>
          <div className="bg-background-soft-200 h-7 w-1.5 rounded-full"></div>
          <div className="bg-background-soft-200 h-7 w-1.5 rounded-full"></div>
          <div className="bg-background-soft-200 h-7 w-1.5 rounded-full"></div>
          <div className="bg-background-soft-200 h-7 w-1.5 rounded-full"></div>
          <div className="bg-background-soft-200 h-7 w-1.5 rounded-full"></div>
          <div className="bg-background-soft-200 h-7 w-1.5 rounded-full"></div>
          <div className="bg-background-soft-200 h-7 w-1.5 rounded-full"></div>
          <div className="bg-background-soft-200 h-7 w-1.5 rounded-full"></div>
          <div className="bg-background-soft-200 h-7 w-1.5 rounded-full"></div>
          <div className="bg-background-soft-200 h-7 w-1.5 rounded-full"></div>
        </div>

        <p className="text-text-100 text-xs font-normal">
          Compared to last month
        </p>
      </div>
    </div>
  );
}
